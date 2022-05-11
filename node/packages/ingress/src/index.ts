import {DaprClient, DaprServer} from "dapr-client";
import ActorProxyBuilder from "dapr-client/actors/client/ActorProxyBuilder";
import ActorId from "dapr-client/actors/ActorId";
import TrajectoryAssemblerInterface from "@mista/trajectory-assembler/src/actor/TrajectoryAssemblerInterface";
import TrajectoryAssemblerImpl from "@mista/trajectory-assembler/src/actor/TrajectoryAssemblerImpl";
import {TrajectoryPoint} from "../../types/TrajectoryPoint";

const fs = require('node:fs');
const readline = require('node:readline');

const daprHost = "127.0.0.1";
const daprPort = "3002";
const serverHost = "127.0.0.1"; // App Host of this Example Server
const serverPort = "3003"; // App Port of this Example Server
const client = new DaprClient(daprHost, daprPort);

function strToPoint(s: string): TrajectoryPoint {
    const data = s.split(',')
    return {
        id: data.at(0),
        time: new Date().getTime(),
        lng: Number(data.at(2)),
        lat: Number(data.at(3))
    }
}

async function main(){
    const server = new DaprServer(serverHost, serverPort, daprHost, daprPort);

    await server.actor.init(); // Let the server know we need actors
    await server.start();

    const rl = readline.createInterface({
        input: fs.createReadStream('/home/liontao/work/mista/data/all.txt'),
        crlfDelay: Infinity
    });

    rl.on('line', async (line) => {
        if (line === "") {
            return;
        }

        const builder = new ActorProxyBuilder<TrajectoryAssemblerInterface>(TrajectoryAssemblerImpl, client);
        const p = strToPoint(line);
        await builder.build(new ActorId(p.id)).acceptNewPoint(p);
        // builder.build(new ActorId(p.id)).acceptNewPoint(p)
        //     .catch(err => {
        //         console.error(err);
        //     })
    });
}

main().catch(err=>console.error(err));


// (async ()=>{
//     const server = new DaprServer(serverHost, serverPort, daprHost, daprPort);
//
//     await server.actor.init(); // Let the server know we need actors
//     await server.start();
//     try {
//         const data = fs.readFileSync('/home/liontao/work/mista/data/all.txt', 'utf8')
//         for(let line of data.split(/\r?\n/)){
//             if (line === "") {
//                 continue;
//             }
//
//             const builder = new ActorProxyBuilder<TrajectoryAssemblerInterface>(TrajectoryAssemblerImpl, client);
//             const p = strToPoint(line);
//             await builder.build(new ActorId(p.id)).acceptNewPoint(p);
//         }
//     } catch (err) {
//         console.error(err)
//     }
// })()