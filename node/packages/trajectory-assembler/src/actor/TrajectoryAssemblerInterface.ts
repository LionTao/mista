import {Point} from "../../../types/Point";


export default interface TrajectoryAssemblerInterface {
    acceptNewPoint(p:Point):Promise<void>;
}