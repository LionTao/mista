import {TrajectoryPoint} from "../../../types/TrajectoryPoint";


export default interface TrajectoryAssemblerInterface {
    acceptNewPoint(p:TrajectoryPoint):Promise<void>;
}