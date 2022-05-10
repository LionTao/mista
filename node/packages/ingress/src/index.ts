import {DaprClient} from "dapr-client";
import ActorProxyBuilder from "dapr-client/actors/client/ActorProxyBuilder";
import ActorId from "dapr-client/actors/ActorId";
import TrajectoryAssemblerInterface from "@mista/trajectory-assembler/src/actor/TrajectoryAssemblerInterface";
import TrajectoryAssemblerImpl from "@mista/trajectory-assembler/src/actor/TrajectoryAssemblerImpl";
import {Point} from "../../types/Point";

const fs = require('node:fs');
const readline = require('node:readline');

const daprHost = "127.0.0.1";
const daprPort = "51000";

const rl = readline.createInterface({
    input: fs.createReadStream('/home/liontao/work/mista/data/all.txt'),
    crlfDelay: Infinity
});

function strToPoint(s: string): Point {
    const data = s.split(',')
    return {
        id: data.at(0),
        time: Date.parse(data.at(1)),
        lng: Number(data.at(2)),
        lat: Number(data.at(3))
    }
}

rl.on('line', (line) => {
    if (line === "") {
        return;
    }

    const client = new DaprClient(daprHost, daprPort);
    const builder = new ActorProxyBuilder<TrajectoryAssemblerInterface>(TrajectoryAssemblerImpl, client);
    const p = strToPoint(line);
    builder.build(new ActorId(p.id)).acceptNewPoint(p).catch(err => {
        console.error(err);
    });
});