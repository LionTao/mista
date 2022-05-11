import {TrajectoryPoint} from "./TrajectoryPoint";

export interface Segment {
    id:string;
    start:TrajectoryPoint;
    end:TrajectoryPoint;
}