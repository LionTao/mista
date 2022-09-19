import { DaprClient, DaprServer } from "dapr-client";
import ActorProxyBuilder from "dapr-client/actors/client/ActorProxyBuilder";
import ActorId from "dapr-client/actors/ActorId";
import TrajectoryAssemblerInterface from "@mista/trajectory-assembler/src/actor/TrajectoryAssemblerInterface";
import TrajectoryAssemblerImpl from "@mista/trajectory-assembler/src/actor/TrajectoryAssemblerImpl";
import { TrajectoryPoint } from "../../types/TrajectoryPoint";

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


async function sendLocalFile() {
    // const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    const server = new DaprServer(serverHost, serverPort, daprHost, daprPort);

    await server.actor.init(); // Let the server know we need actors
    await server.start();

    try {

        const data = fs.readFileSync('/home/liontao/work/mista/data/all-100.txt', 'utf8');
        console.time("time");
        let counter=0;
        const builder = new ActorProxyBuilder<TrajectoryAssemblerInterface>(TrajectoryAssemblerImpl, client);
        for (let line of data.split(/\r?\n/)) {
            if (line === "") {
                continue;
            }
            const p = strToPoint(line);
            const actor = builder.build(new ActorId(p.id));
            while (true) {
                let c=0;
                try{
                    await actor.acceptNewPoint(p);
                    break;
                } catch (err){
                    ++c;
                    if (c%5===0){console.log("retry:",c);}
                    await new Promise(resolve=>setTimeout(resolve,500));
                }
            }
            counter=counter+1;
        }
        console.timeEnd("time");
        console.log("end",counter);
    } catch (err) {
        console.error(err)
    }
}

async function start() {
    // Note that the DAPR_HTTP_PORT and DAPR_GRPC_PORT environment variables are set by DAPR itself. https://docs.dapr.io/reference/environment/
    const server = new DaprServer(serverHost, serverPort, daprHost, daprPort);

    // Initialize the subscription. Note that this must be done BEFORE calling .start()
    await server.pubsub.subscribe("mykafka", "point", async (data: Record<string, any>) => {
        // The library parses JSON when possible.
        const builder = new ActorProxyBuilder<TrajectoryAssemblerInterface>(TrajectoryAssemblerImpl, client);
        const p = data as TrajectoryPoint;
        const actor = builder.build(new ActorId(p.id));
        await actor.acceptNewPoint(p);
        return;
    });
    await server.start();

    // Publish a message
    // console.log("[Dapr-JS][Example] Publishing message");

    // // Internally, the message will be serialized using JSON.stringify()
    // await client.pubsub.publish("mykafka", "point", { hello: "world" });
}

sendLocalFile().catch((e) => {
    console.error(e);
    process.exit(1);
});