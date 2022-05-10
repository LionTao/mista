import {AbstractActor, HttpMethod} from "dapr-client";
import TrajectoryAssemblerInterface from "./TrajectoryAssemblerInterface";
import {Point} from "../../../types/Point";
import {isNil, throttle} from "lodash-es";
import {Segment} from "../../../types/Segment";
import RBush, {BBox} from "rbush";
import {DistributedIndexImpl, DistributedIndexInterface} from "@mista/distributed-index/src/index"
import * as proj4 from "proj4";
import {DaprClient} from "dapr-client";
import {PNSEntry} from "../../../types/PNSEntry";
import RWLock from "async-rwlock";
import ActorProxyBuilder from "dapr-client/actors/client/ActorProxyBuilder";
import ActorId from "dapr-client/actors/ActorId";


const TRAJETORY_STORE_NAME = "trajectory";

export default class TrajectoryAssemblerImpl extends AbstractActor implements TrajectoryAssemblerInterface {
    private PNS: RBush<PNSEntry>;
    private previousPoint: Point | null;
    private lock: RWLock;


    constructor(daprClient: DaprClient, id: ActorId) {
        super(daprClient, id);
        this.PNS = new RBush<PNSEntry>();
        this.previousPoint = null;
        this.lock = new RWLock();
    }

    async onActivate() {
        const [hasValue, value] = await this.getStateManager().tryGetState("previousPoint");
        this.previousPoint = hasValue ? value : null;
        return;
    };

    async acceptNewPoint(p: Point): Promise<void> {
        const client = this.getDaprClient();
        const myActorState = this.getStateManager();
        if (!isNil(this.previousPoint)) {
            // 如果是第二个点就可以构成线段
            const newSegment: Segment = {
                id: this.getActorId().getId(),
                start: this.previousPoint,
                end: p
            }
            // send to index
            this.sendSegment(newSegment)
                .catch(err => {
                    console.error(err);
                })
        }
        this.previousPoint = p;
        await myActorState.setState("previousPoint", this.previousPoint);
        client.state.save(TRAJETORY_STORE_NAME, [
            {
                key: `${p.id}-${p.time}`,
                value: p
            }
        ]).catch(err => {
            console.error(err);
        })
        return;
    }

    async sendSegment(s: Segment) {
        const client = this.getDaprClient();
        const builder = new ActorProxyBuilder<DistributedIndexInterface>(DistributedIndexImpl, client);

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
        const box: BBox = {
            minX: minX,
            minY: minY,
            maxX: maxX,
            maxY: maxY
        }
        let targets = this.PNS.search(box);
        while (isNil(targets)) {
            await this.updatePNS();
        }
        let tasks = Array<Promise<boolean>>();
        for (let t of targets) {
            const actor = builder.build(new ActorId(t.id));
            tasks.push(actor.acceptNewSegment(s));
        }
        let statusCode = await Promise.all(tasks);
        if (statusCode.includes(false)) {
            await this.updatePNS();
        }
        return;
    }

    updatePNS = throttle(async () => {
        await this.lock.writeLock()
        const newTree = String(await this.getDaprClient().invoker.invoke("pns-damon", "query", HttpMethod.GET));
        this.PNS.clear();
        this.PNS.load(JSON.parse(newTree));
        this.lock.unlock()
    }, 1000)
}

