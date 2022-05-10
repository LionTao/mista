import {AbstractActor} from "dapr-client";
import {Segment} from "../../../types/Segment";
import RBush, {BBox} from "rbush";
import DistributedIndexInterface from "./DistributedIndexInterface";
import {RBushEntry} from "../../../types/RBushEntry";
import {geoToH3, h3GetResolution, h3ToCenterChild, kRing} from "h3-js";

import * as proj4 from "proj4";
import {isNil} from "lodash-es";
import {DaprClient} from "dapr-client";
import ActorProxyBuilder from "dapr-client/actors/client/ActorProxyBuilder";
import ActorId from "dapr-client/actors/ActorId";

const SPLIT_TRESHOLED = 2000;

interface IndexRBushEntry extends RBushEntry {
    nextH3: Array<string>;
}

export default class DistributedIndexImpl extends AbstractActor implements DistributedIndexInterface {
    rtree: RBush<IndexRBushEntry>;
    // buffer: Array<Segment>;
    isRetired: Boolean;
    resolution: number;
    children: Array<string>;

    constructor(daprClient: DaprClient, id: ActorId) {
        super(daprClient, id);
        this.rtree = new RBush<IndexRBushEntry>();
        this.isRetired = false;
        this.resolution = 16;
        this.children = [];
    }

    async onActivate(): Promise<void> {
        const [hasRtree, rtreeJSON] = await this.getStateManager().tryGetState("rtree");
        this.rtree = hasRtree ? new RBush<IndexRBushEntry>().fromJSON(rtreeJSON) : new RBush<IndexRBushEntry>();
        // const [hasBuffer, bufferData] = await this.getStateManager().tryGetState("buffer");
        // this.buffer = hasBuffer ? bufferData : new Array<Segment>();
        const [hasRetired, retiredFlag] = await this.getStateManager().tryGetState("retired");
        this.isRetired = hasRetired ? retiredFlag : false;
        this.resolution = h3GetResolution(this.getActorId().getId());
        this.children = this.resolution < 15 ?
            kRing(h3ToCenterChild(this.getActorId().getId(), this.resolution + 1), 2) : [];
    }

    async onDeactivate(): Promise<void> {
        const stateManager = this.getStateManager();
        if (this.rtree && this.rtree.all().length > 0) {
            await stateManager.setState("rtree", this.rtree.toJSON());
        }
        // if (this.buffer.length > 0) {
        //     await stateManager.setState("buffer", this.buffer);
        // }
        await stateManager.setState("retired", this.isRetired);
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
            const targets = [startH3, endH3].filter(t => this.children.includes(t))
            targets.forEach(t => {
                const actor = builder.build(new ActorId(t));
                actor.acceptNewSegment(s).catch(err => {
                    console.error(err)
                });
            })
            return false;
        }
        if (isNil(this.rtree)) {
            this.rtree = new RBush<IndexRBushEntry>();
        }
        this.rtree = this.rtree.insert(this.segmentToRBushEntry(s));
        // TODO: 给消息队列发消息
        console.log(`latency: ${new Date().getTime() - s.end.time}`)
        return true;
    }

    async bulkLoadInternal(segments: Array<Segment>): Promise<void> {
        if (this.isRetired) {
            this.bulkLoadInternal(segments)
                .catch(err => {
                    console.error(err);
                })
            return;
        }
        if (isNil(this.rtree)) {
            this.rtree = new RBush<IndexRBushEntry>();
        }
        this.rtree = this.rtree.load(segments.map(this.segmentToRBushEntry));
        return;
    }

    async onActorMethodPost(): Promise<void> {
        if (isNil(this.rtree)) {
            this.rtree = new RBush<IndexRBushEntry>();
        }
        if (isNil(this.resolution)) {
            this.resolution = h3GetResolution(this.getActorId().getId());
        }
        if (this.resolution < 15 && this.rtree.all().length > SPLIT_TRESHOLED) {
            this.isRetired = true
            // TODO:通知更新pns
            // 分派下一层分区
            const buckets = Array<Array<Segment>>();
            for (let i in this.children) {
                // @ts-ignore
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
            for (let partition in buckets) {
                const data = buckets[partition];
                if (data.length > 0) {
                    this.getDaprClient()
                        .actor
                        .create<DistributedIndexInterface>(DistributedIndexImpl)
                        .bulkLoadInternal(data)
                        .catch(err => {
                            console.error(err);
                        })
                }
            }
            return;
        }
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
        const fromProjection = proj4.Proj('EPSG:4326');
        const toProjection = proj4.Proj("EPSG:3857");
        const startPoint = s.start;
        const endPoint = s.end;
        const [startX, startY] = proj4.transform(fromProjection, toProjection, [startPoint.lng, startPoint.lat]);
        const [endX, endY] = proj4.transform(fromProjection, toProjection, [endPoint.lng, endPoint.lat]);
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