import { DaprServer, HttpMethod } from "@dapr/dapr/src/index";
import RBush from "rbush";
import { PNSEntry } from "../../types/PNSEntry";
import { getRes0Indexes, h3SetToMultiPolygon } from "h3-js";
import * as proj4 from "proj4";
import RWLock from "async-rwlock";

const daprHost = "127.0.0.1";
const daprPort = "50000"; // Dapr Sidecar Port of this Example Server
const serverHost = "127.0.0.1"; // App Host of this Example Server
const serverPort = "50001"; // App Port of this Example Server

let rtree = new RBush<PNSEntry>();
const lock = new RWLock();
interface UpdateData {
    mother: string;
    children: Array<string>;
}

async function update(data: UpdateData): Promise<void> {
    await lock.writeLock();
    rtree.remove(h3ToBBox(data.mother), (a, b) => a.id === b.id);
    rtree.load(data.children.map(h3ToBBox));
    lock.unlock;
    return;
}

async function query(): Promise<string> {
    await lock.readLock();
    const res = JSON.stringify(rtree.toJSON());
    lock.unlock;
    return res;
}

async function start() {
    // Create a Server (will subscribe) and Client (will publish)
    const server = new DaprServer(serverHost, serverPort, daprHost, daprPort);
    await lock.writeLock();
    rtree.load(getRes0Indexes().map(h3ToBBox));
    lock.unlock();

    await server.invoker.listen("update", (data) => update(JSON.parse(data.body)), { method: HttpMethod.POST });
    await server.invoker.listen("query", () => query(), { method: HttpMethod.GET });

    await server.start();
}

function h3ToBBox(h: string): PNSEntry {
    const coordinates = h3SetToMultiPolygon([h], false)[0][0];
    const fromProjection = proj4.Proj('EPSG:4326');
    const toProjection = proj4.Proj("EPSG:3857");
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    coordinates.forEach(p => {
        const [x, y] = proj4.transform(fromProjection, toProjection, [p[1], p[0]]);
        minX = Math.min(x, minX);
        minY = Math.min(y, minY);
        maxX = Math.max(x, maxX);
        maxY = Math.max(y, maxY);
    })
    const res: PNSEntry = {
        minX: minX,
        minY: minY,
        maxX: maxX,
        maxY: maxY,
        id: h
    }
    return res;
}

start().catch((e) => {
    console.error(e);
    process.exit(1);
});