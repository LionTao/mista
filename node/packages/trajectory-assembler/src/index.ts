import {DaprServer} from "dapr-client";
import TrajectoryAssemblerImpl from "./actor/TrajectoryAssemblerImpl";

const daprHost = "127.0.0.1";
const daprPort = "3008"; // Dapr Sidecar Port of this Example Server
const serverHost = "127.0.0.1"; // App Host of this Example Server
const serverPort = "3009"; // App Port of this Example Server

async function start() {
    const server = new DaprServer(serverHost, serverPort, daprHost, daprPort);

    await server.actor.init(); // Let the server know we need actors
    await server.actor.registerActor(TrajectoryAssemblerImpl); // Register the actor
    await server.start(); // Start the server
}

start().catch((e) => {
    console.error(e);
    process.exit(1);
});