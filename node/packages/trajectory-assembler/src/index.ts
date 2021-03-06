import {DaprClient, DaprServer, Temporal} from "dapr-client";
import TrajectoryAssemblerImpl from "./actor/TrajectoryAssemblerImpl";
import ActorRuntime from "dapr-client/actors/runtime/ActorRuntime";
import ActorRuntimeConfig from "dapr-client/actors/runtime/ActorRuntimeConfig";

const daprHost = "127.0.0.1";
const daprPort = process.env.DAPR_PORT || "3008"; // Dapr Sidecar Port of this Example Server
const serverHost = "127.0.0.1"; // App Host of this Example Server
const serverPort = process.env.SERVER_PORT || "3009"; // App Port of this Example Server

async function start() {
    const server = new DaprServer(serverHost, serverPort, daprHost, daprPort);

    const runtime = ActorRuntime.getInstanceByDaprClient(new DaprClient(daprHost, daprPort));
    const newConfig = new ActorRuntimeConfig(
        Temporal.Duration.from({ minutes: 10 })
        , Temporal.Duration.from({ seconds: 10 })
        , Temporal.Duration.from({ minutes: 10 })
        , true
    );
    runtime.setActorRuntimeConfig(newConfig);

    await server.actor.init(); // Let the server know we need actors
    await server.actor.registerActor(TrajectoryAssemblerImpl); // Register the actor
    await server.start(); // Start the server
}

start().catch((e) => {
    console.error(e);
    process.exit(1);
});