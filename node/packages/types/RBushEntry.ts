import {BBox} from "rbush";
import {Segment} from "./Segment";

export interface RBushEntry extends BBox{
    segment:Segment;
}