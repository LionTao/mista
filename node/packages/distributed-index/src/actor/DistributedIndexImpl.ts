import { AbstractActor, DaprClient, HttpMethod } from "dapr-client";
import { Segment } from "../../../types/Segment";
import RBush, { BBox } from "rbush";
import DistributedIndexInterface from "./DistributedIndexInterface";
import { RBushEntry } from "../../../types/RBushEntry";
import { geoToH3, h3GetResolution, h3ToCenterChild, kRing } from "h3-js";

import proj4 from "proj4";
import { isNil } from "lodash-es";
import ActorProxyBuilder from "dapr-client/actors/client/ActorProxyBuilder";
import ActorId from "dapr-client/actors/ActorId";
import { UpdateData } from "@mista/pns-daemon/src";
import RWLock from "async-rwlock";

const SPLIT_TRESHOLED = 500;

const pnsDaemonAppName = "pns-daemon";
const pndAppMethodName = "update";

interface IndexRBushEntry extends RBushEntry {
    nextH3: Array<string>;
}

export default class DistributedIndexImpl extends AbstractActor implements DistributedIndexInterface {
    rtree: RBush<IndexRBushEntry>;
    // buffer: Array<Segment>;
    isRetired: Boolean;
    resolution: number;
    children: Array<string>;
    count: number;
    invertedIndex: Map<string, Array<string>>;
    lock: RWLock;

    constructor(daprClient: DaprClient, id: ActorId) {
        super(daprClient, id);
        this.rtree = new RBush<IndexRBushEntry>();
        this.isRetired = false;
        this.resolution = 16;
        this.children = [];
        this.count = 0;
        this.lock = new RWLock();
        this.invertedIndex = new Map<string, Array<string>>();
    }

    async onActivate(): Promise<void> {
        const [hasRtree, rtreeJSON] = await this.getStateManager().tryGetState("rtree");
        this.rtree = hasRtree ? new RBush<IndexRBushEntry>().fromJSON(rtreeJSON) : new RBush<IndexRBushEntry>();

        // const [hasBuffer, bufferData] = await this.getStateManager().tryGetState("buffer");
        // this.buffer = hasBuffer ? bufferData : new Array<Segment>();

        const [hasCount, countData] = await this.getStateManager().tryGetState("count");
        this.count = hasCount ? countData : 0;

        const [hasRetired, retiredFlag] = await this.getStateManager().tryGetState("retired");
        this.isRetired = hasRetired ? retiredFlag : false;

        const [hasinvertedIndex, invertedIndexData] = await this.getStateManager().tryGetState("invertedIndex");
        this.invertedIndex = hasinvertedIndex ? invertedIndexData : new Map<string, Array<string>>();

        this.resolution = h3GetResolution(this.getActorId().getId());
        this.children = this.resolution < 15 ?
            kRing(h3ToCenterChild(this.getActorId().getId(), this.resolution + 1), 2) : [];
        this.lock = new RWLock();
        console.log(`${this.getActorId().getId()}, level: ${this.resolution}, activated`);
    }

    async onDeactivate(): Promise<void> {
        const stateManager = this.getStateManager();
        if (this.rtree && this.count > 0) {
            await stateManager.setState("rtree", this.rtree.toJSON());
            await stateManager.setState("count", this.count);
            await stateManager.setState("invertedIndex", this.invertedIndex);
        }
        // if (this.buffer.length > 0) {
        //     await stateManager.setState("buffer", this.buffer);
        // }
        await stateManager.setState("retired", this.isRetired);
        console.log(`${this.getActorId().getId()}, level: ${this.resolution}, deactivated`);
    }

    /**
     * 这个接口面向Assembler，用于接收新到的轨迹
     * 如果此分区正常工作就收容，如果已经退休就帮忙往下一层传递并且返回false作为提醒
     * @param s 轨迹段
     */
    async acceptNewSegment(s: Segment): Promise<boolean> {
        if (this.isRetired) {
            const client = this.getDaprClient();
            const builder = new ActorProxyBuilder<DistributedIndexInterface>(DistributedIndexImpl, client);
            const startH3 = geoToH3(s.start.lat, s.start.lng, this.resolution + 1)
            const endH3 = geoToH3(s.end.lat, s.end.lng, this.resolution + 1)
            const targets = Array.from(new Set([startH3, endH3])).filter(t => this.children.includes(t))
            targets.forEach(async t => {
                const actor = builder.build(new ActorId(t));
                // actor.acceptNewSegment(s).catch(err => {
                //     console.error(err)
                // });
                actor.acceptNewSegment(s).catch(err => { console.log(err) });
            });
            return false;
        }
        // if (this.getActorId().getId() === "823187fffffffff") {
        //     console.log("WARN:823187fffffffff!", this.count);
        // }
        if (isNil(this.rtree)) {
            this.rtree = new RBush<IndexRBushEntry>();
        }
        await this.lock.writeLock();
        this.rtree = this.rtree.insert(this.segmentToRBushEntry(s));
        this.count += 1;
        this.lock.unlock();
        console.log(`latency: ${new Date().getTime() - s.end.time}`);
        return true;
    }

    async bulkLoadInternal(segments: Array<Segment>): Promise<void> {
        if (this.isRetired) {
            const client = this.getDaprClient();
            const builder = new ActorProxyBuilder<DistributedIndexInterface>(DistributedIndexImpl, client);
            // 向下传递
            const entries = segments.map(this.segmentToRBushEntry);
            // 分派下一层分区
            const buckets = Array<Array<Segment>>();
            for (let i in this.children) {
                buckets[i] = Array<Segment>();
            }
            entries.forEach(entry => {
                entry.nextH3.forEach(i => {
                    if (i in buckets.keys()) {
                        // @ts-ignore
                        buckets[i].push(entry.segment);
                    }
                })
            })
            for (let partitionID in buckets) {
                const data = buckets[partitionID];
                if (data.length > 0) {
                    const actor = builder.build(new ActorId(partitionID))
                    actor.bulkLoadInternal(data).catch(err => { console.log(err) });
                }
            }
            return;
        }
        if (isNil(this.rtree)) {
            this.rtree = new RBush<IndexRBushEntry>();
        }
        await this.lock.writeLock();
        this.rtree = this.rtree.load(segments.map(this.segmentToRBushEntry));
        this.count += segments.length;
        this.lock.unlock();
        return;
    }

    async onActorMethodPost(): Promise<void> {
        if (!this.isRetired && this.resolution < 15 && this.count > (this.resolution + 1) * 0.5 * SPLIT_TRESHOLED) {
            const client = this.getDaprClient();
            const builder = new ActorProxyBuilder<DistributedIndexInterface>(DistributedIndexImpl, client);
            this.isRetired = true
            const payload: UpdateData = {
                mother: this.getActorId().getId(),
                children: this.children
            }
            this.getDaprClient().invoker.invoke(pnsDaemonAppName, pndAppMethodName, HttpMethod.POST, payload).catch(err => console.error(err));
            // 分派下一层分区
            const buckets = Array<Array<Segment>>();
            for (let i in this.children) {
                buckets[i] = Array<Segment>();
            }
            this.rtree.all().forEach(entry => {
                entry.nextH3.forEach(i => {
                    if (i in buckets.keys()) {
                        // @ts-ignore
                        buckets[i].push(entry.segment);
                    }
                })
            })
            for (let partitionID in buckets) {
                const data = buckets[partitionID];
                if (data.length > 0) {
                    const actor = builder.build(new ActorId(partitionID))
                    // await actor.bulkLoadInternal(data);
                    actor.bulkLoadInternal(data).catch(err => { console.log(err) });
                }
            }
            return;
        }
        return;
    }

    async query(bbox: BBox): Promise<Array<string>> {
        if (isNil(this.rtree)) {
            this.rtree = new RBush<IndexRBushEntry>();
        }
        return this.rtree
            .search(bbox)
            .map((r) => {
                return r.segment.id
            });
    }

    /**
     * 将gps坐标额线段转换成墨卡托投影的MBR
     * @param s 线段
     */
    segmentToRBushEntry(s: Segment): IndexRBushEntry {
        const r = this.resolution
        const startPoint = s.start;
        const endPoint = s.end;
        const [startX, startY] = proj4("EPSG:4326", "EPSG:3857", [startPoint.lng, startPoint.lat]);
        const [endX, endY] = proj4("EPSG:4326", "EPSG:3857", [endPoint.lng, endPoint.lat]);
        const minX = Math.min(startX, endX);
        const minY = Math.min(startY, endY);
        const maxX = Math.max(startX, endX);
        const maxY = Math.max(startY, endY);
        const startNextIndex = r < 15 ? geoToH3(startPoint.lat, startPoint.lng, r + 1) : ""
        const endNextIndex = r < 15 ? geoToH3(startPoint.lat, startPoint.lng, r + 1) : ""
        return {
            minX: minX,
            minY: minY,
            maxX: maxX,
            maxY: maxY,
            segment: s,
            nextH3: [startNextIndex, endNextIndex]
        }
    }
}