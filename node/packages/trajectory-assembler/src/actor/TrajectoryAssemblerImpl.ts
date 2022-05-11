import {AbstractActor, DaprClient, HttpMethod} from "dapr-client";
import TrajectoryAssemblerInterface from "./TrajectoryAssemblerInterface";
import {TrajectoryPoint} from "../../../types/TrajectoryPoint";
import {isNil, throttle} from "lodash-es";
import {Segment} from "../../../types/Segment";
import RBush, {BBox} from "rbush";
import DistributedIndexImpl from "@mista/distributed-index/src/actor/DistributedIndexImpl";
import DistributedIndexInterface from "@mista/distributed-index/src/actor/DistributedIndexInterface";
import proj4 from "proj4";
import {PNSEntry} from "../../../types/PNSEntry";
import RWLock from "async-rwlock";
import ActorProxyBuilder from "dapr-client/actors/client/ActorProxyBuilder";
import ActorId from "dapr-client/actors/ActorId";
import console from "console";


const TRAJETORY_STORE_NAME = "trajectory";
const pnsDaemonAppName = "pns-daemon";
const pndAppMethodName = "query";

export default class TrajectoryAssemblerImpl extends AbstractActor implements TrajectoryAssemblerInterface {
    private PNS: RBush<PNSEntry>;
    private previousPoint: TrajectoryPoint | null;
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

    async acceptNewPoint(p: TrajectoryPoint): Promise<void> {
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
        } else {
            console.log(`${this.getActorId().getId()}nice to meet you!`);
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
        const startPoint = s.start;
        const endPoint = s.end;
        const [startX, startY] = proj4('EPSG:4326', "EPSG:3857", [startPoint.lng, startPoint.lat]);
        const [endX, endY] = proj4('EPSG:4326', "EPSG:3857", [endPoint.lng, endPoint.lat]);
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
        while (isNil(targets) || targets.length == 0) {
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
        const newTree = (await this.getDaprClient().invoker.invoke(pnsDaemonAppName, pndAppMethodName, HttpMethod.GET)) as unknown as string;
        this.PNS = new RBush<PNSEntry>().fromJSON(JSON.parse(newTree));
        console.log(`Update success, load:${this.PNS.all().length} entries`);
        this.lock.unlock()
    }, 1000)
}

