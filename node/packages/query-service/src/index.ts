import DistributedIndexImpl from "@mista/distributed-index/src/actor/DistributedIndexImpl";
import DistributedIndexInterface from '@mista/distributed-index/src/actor/DistributedIndexInterface';
import RWLock from "async-rwlock";
import * as console from "console";
import { DaprClient, HttpMethod } from "dapr-client";
import ActorId from "dapr-client/actors/ActorId";
import ActorProxyBuilder from "dapr-client/actors/client/ActorProxyBuilder";
import fastify from 'fastify';
import * as process from "process";
import buffer from "@turf/buffer";
import { LineString } from "@turf/helpers";
import bbox from "@turf/bbox"

import proj4 from "proj4";
import RBush, { BBox } from "rbush";
import { PNSEntry } from "../../types/PNSEntry";
import { TrajectoryPoint } from "../../types/TrajectoryPoint";
import { BBox2d } from "@turf/helpers/dist/js/lib/geojson";


const daprHost = "127.0.0.1";
const daprPort = "3006"; // Dapr Sidecar Port of this Example Server
// const serverHost = "127.0.0.1"; // App Host of this Example Server
const serverPort = "3007"; // App Port of this Example Server
const trajectoryStoreName = "trajectory";
const pnsDaemonAppName = "pns-daemon";
const pndAppMethodName = "query";
let PNS = new RBush<PNSEntry>();
const lock = new RWLock();


const client = new DaprClient(daprHost, daprPort);

async function getTrajectory(id: string): Promise<Array<TrajectoryPoint>> {
    const client = new DaprClient(daprHost, daprPort);
    const res = await client.state.query(trajectoryStoreName,
        {
            filter: {
                EQ: { id: `${id}` }
            },
            sort: [
                {
                    key: "time",
                    order: "ASC"
                }
            ],
            page: {
                limit: 1000
            }
        })
    return res.results.map(p => p.data)
}

function bufferTarget(points: Array<TrajectoryPoint>, radius: number = 1000): BBox {
    // @turf/buffer use spherical coordinates
    const line: LineString = {
        type: "LineString",
        coordinates: points.map(r => [r.lng, r.lat])
    }
    const buffered = buffer(line, radius, {
        units: "meters",
        steps: 8
    })
    const box = bbox(buffered) as BBox2d
    const [minX, minY] = proj4('EPSG:4326', "EPSG:3857", [box[0], box[1]]);
    const [maxX, maxY] = proj4('EPSG:4326', "EPSG:3857", [box[2], box[3]]);
    return {
        minX: minX,
        minY: minY,
        maxX: maxX,
        maxY: maxY,
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

async function query(id: string, batchSize: number = 10, start = performance.now()): Promise<string> {
    // get trajectory
    const trajectory = await getTrajectory(id);
    // buffer to polygon then BBox
    const box = bufferTarget(trajectory, 1); // km
    // search PNS
    await lock.readLock();
    const regions = PNS.search(box);
    lock.unlock();
    // query index
    const tasks = Array<Promise<Array<string>>>();
    regions.forEach(r => {
        const builder = new ActorProxyBuilder<DistributedIndexInterface>(DistributedIndexImpl, client);
        tasks.push(builder.build(new ActorId(r.id)).query(box));
    })
    const queryResponse = await Promise.all(tasks);
    const candidates: Array<string> = Array.from(new Set(queryResponse.flat()));
    console.log("candidates:", candidates);

    const computeTasks = Array<Promise<object>>();
    // compute
    for (let i = 0; i < candidates.length; i += batchSize) {
        const chunk = candidates.slice(i, i + batchSize);
        const payload: Payload = {
            target: trajectory.map(p => [p.lng, p.lat]),
            candidates: chunk
        };
        console.log("payload", payload);
        computeTasks.push(client.invoker.invoke("compute", "hausdorff", HttpMethod.POST, payload));
    }
    const distancesResponse = await Promise.all(computeTasks);
    const distances = Array<ComputeResult>();
    for (let r of distancesResponse) {
        const data = r as Array<ComputeResult>;
        data.forEach(result => distances.push(result));
    }
    // sort
    distances.sort((a, b) => a.distance < b.distance ? -1 : 1)
    // send result
    console.log(`Query latency: ${performance.now() - start}ms`);
    distances.forEach(r => console.log(r.id, r.distance))
    return `Query latency: ${performance.now() - start}ms`;
}

const server = fastify()

server.get('/ping', async (request, reply) => {
    console.log(request.ip);
    reply.status(200);
    return 'pong\n';
})

interface IQuerystring {
    id: string;
}

server.get<{ Querystring: IQuerystring }>(
    '/query', async (request, reply) => {
        const { id } = request.query;
        reply.status(200);
        return await query(id);
    }
)

async function updatePNS(): Promise<void> {
    const newTree = (await client.invoker.invoke(pnsDaemonAppName, pndAppMethodName, HttpMethod.GET)) as unknown as string;
    await lock.writeLock();
    PNS = new RBush<PNSEntry>().fromJSON(JSON.parse(newTree));
    lock.unlock();
    console.log(`Update success, load:${PNS.all().length}`);
}

server.listen(serverPort, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server listening at ${address}`);
    setInterval(async () => {
        updatePNS()
            .catch(err => console.error("Update failed", err))
            .finally(() => {
                try {
                    lock.unlock()
                } catch (e) {
                    // console.log("Already unlocked");
                }
            });
    }, 3000)
})