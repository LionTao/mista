import fastify from 'fastify';
import {DaprClient, HttpMethod} from "dapr-client";
import * as console from "console";
import {Point} from "../../types/Point";
import * as proj4 from "proj4";
import RBush, {BBox} from "rbush";
import RWLock from "async-rwlock";
import {PNSEntry} from "../../types/PNSEntry";
import ActorProxyBuilder from "dapr-client/actors/client/ActorProxyBuilder";
import {DistributedIndexImpl, DistributedIndexInterface} from "@mista/distributed-index/src/index"
import ActorId from "dapr-client/actors/ActorId";
import {env} from 'node:process';
import {isNil} from "lodash-es";
import * as process from "process";

const jsts = require('jsts');
const daprHost = "127.0.0.1";
const daprPort = "51000"; // Dapr Sidecar Port of this Example Server
// const serverHost = "127.0.0.1"; // App Host of this Example Server
// const serverPort = "51001"; // App Port of this Example Server
if (isNil(env.COMPUTE_GATEWAY)) {
    console.error("No compute gateway defined.");
    process.exit(1);
}
const computeGateway = env.COMPUTE_GATEWAY;
let PNS = new RBush<PNSEntry>();
const lock = new RWLock();

async function getTrajectory(id: string): Promise<Array<Point>> {
    const client = new DaprClient(daprHost, daprPort);
    const res = await client.state.query("trajectory",
        {
            "filter": {
                "EQ": {"id": `${id}`}
            },
            "sort": [
                {
                    "key": "time",
                    "order": "ASC"
                }
            ],
            "page": null
        })
    return res.results.map(p => p.data)
}

function wgs84ToMercatorCoordinate(p: Point): jsts.geom.Coordinate {
    const fromProjection = proj4.Proj('EPSG:4326');
    const toProjection = proj4.Proj("EPSG:3857");
    const [x, y] = proj4.transform(fromProjection, toProjection, [p.lng, p.lat]);
    return new jsts.geom.Coordinate(x, y);
}

function bufferTarget(points: Array<jsts.geom.Coordinate>, buffer:number=100): BBox {
    const line: jsts.geom.Envelope = new jsts.geom.LineString(points)
        .buffer(buffer)
        .envelope;
    return {
        minX: line.getMinX(),
        minY: line.getMinY(),
        maxX: line.getMaxX(),
        maxY: line.getMaxY()
    }
}

interface ComputeResult {
    id: string;
    distance: number;
}

interface Payload {
    target: Array<Array<number>>;
    candidates: Array<string>;
}

async function query(id: string, batchSize: number = 4, start = performance.now()): Promise<void> {
    // get trajectory
    const trajectory = await getTrajectory(id);
    // buffer to polygon then BBox
    const box = bufferTarget(trajectory.map(wgs84ToMercatorCoordinate), 1000);
    // search PNS
    await lock.readLock();
    const regions = PNS.search(box);
    lock.unlock();
    // query index
    const tasks = Array<Promise<Array<string>>>();
    regions.forEach(r => {
        const client = new DaprClient(daprHost, daprPort);
        const builder = new ActorProxyBuilder<DistributedIndexInterface>(DistributedIndexImpl, client);
        tasks.push(builder.build(new ActorId(r.id)).query(box));
    })
    const queryResponse = await Promise.all(tasks);
    const candidates: Array<string> = [].concat(...queryResponse);

    const computeTasks = Array<Promise<Response>>();
    // compute
    for (let i = 0; i < candidates.length; i += batchSize) {
        const chunk = candidates.slice(i, i + batchSize);
        const payload: Payload = {
            target: trajectory.map(p => [p.lng, p.lat]),
            candidates: chunk
        };
        computeTasks.push(fetch(computeGateway, {
            method: "POST",
            body: JSON.stringify(payload),
            headers: {'Content-Type': 'application/json'}
        }));
    }
    const distancesResponse = await Promise.all(computeTasks);
    const distances = Array<ComputeResult>();
    for (let r of distancesResponse) {
        const data = await r.json() as Array<ComputeResult>
        data.forEach(result => distances.push(result));
    }
    // sort
    distances.sort((a, b) => a.distance < b.distance ? -1 : 1)
    // send result
    console.log(`Query latency: ${performance.now() - start}ms, results: ${distances}`);
    return;
}

const server = fastify()

server.get('/ping', async (request, reply) => {
    console.log(request.ip);
    reply.status(200);
    return 'pong\n';
})

server.listen(8080, (err, address) => {
    if (err) {
        console.error(err)
        process.exit(1)
    }
    console.log(`Server listening at ${address}`)
    setInterval(async () => {
        const client = new DaprClient(daprHost, daprPort);
        await lock.writeLock()
        const newTree = String(await client.invoker.invoke("pns-damon", "query", HttpMethod.GET));
        PNS = PNS.clear();
        PNS = PNS.load(JSON.parse(newTree));
        lock.unlock();
    }, 3000)
})