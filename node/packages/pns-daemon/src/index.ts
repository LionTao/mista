import {DaprServer, HttpMethod} from "dapr-client";
import RBush from "rbush";
import {PNSEntry} from "../../types/PNSEntry";
import {getRes0Indexes, h3SetToMultiPolygon} from "h3-js";
import proj4 from "proj4";
import RWLock from "async-rwlock";
import {isNil} from "lodash-es";

const daprHost = "127.0.0.1";
const daprPort = "3004"; // Dapr Sidecar Port of this Example Server
const serverHost = "127.0.0.1"; // App Host of this Example Server
const serverPort = "3005"; // App Port of this Example Server

let rtree = new RBush<PNSEntry>();
const regionBook = new Set<string>(); // 存放现在正在工作的节点编号
const nursingHome = new Set<string>(); // 养老院，存放退休节点编号
const lock = new RWLock();

export interface UpdateData {
    mother: string;
    children: Array<string>;
}

async function update(data: UpdateData): Promise<void> {
    const before = regionBook.size
    await lock.writeLock();
    // regionBook.delete(data.mother);
    nursingHome.add(data.mother);
    data.children.filter(r=>!nursingHome.has(r)).forEach(r=>regionBook.add(r));
    rtree = new RBush<PNSEntry>().load(Array.from(regionBook).map(h3ToBBox));
    lock.unlock();
    console.log(`before:${before},after:${regionBook.size},${data.mother} to ${data.children.join(",")}`)
    return;
}

async function query(): Promise<string> {
    await lock.readLock();
    const res = JSON.stringify(rtree.toJSON());
    lock.unlock();
    return res;
}

async function start() {
    const server = new DaprServer(serverHost, serverPort, daprHost, daprPort);
    await lock.writeLock();
    const newRegions = getRes0Indexes().map(h3ToBBox);
    getRes0Indexes().forEach(r=>regionBook.add(r));
    rtree = rtree.load(newRegions);
    lock.unlock();

    await server.invoker.listen("update", async (data) => {
        const jsonString = isNil(data.body) ? "" : data.body;
        return await update(JSON.parse(jsonString));
    }, {method: HttpMethod.POST});
    await server.invoker.listen("query", async () => await query(), {method: HttpMethod.GET});

    await server.start();
}

function h3ToBBox(h: string): PNSEntry {
    const coordinates = h3SetToMultiPolygon([h], false)[0][0];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    coordinates.forEach(p => {
        const [x, y] = proj4("EPSG:4326", "EPSG:3857", [p[1], p[0]]);
        minX = Math.min(x, minX);
        minY = Math.min(y, minY);
        maxX = Math.max(x, maxX);
        maxY = Math.max(y, maxY);
    })
    return {
        minX: minX,
        minY: minY,
        maxX: maxX,
        maxY: maxY,
        id: h
    };
}

start().catch((e) => {
    console.error(e);
    process.exit(1);
});