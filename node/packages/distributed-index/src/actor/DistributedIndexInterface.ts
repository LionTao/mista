import {Segment} from "../../../types/Segment";
import {BBox} from "rbush";


export default interface DistributedIndexInterface {
    acceptNewSegment(s:Segment):Promise<boolean>;
    bulkLoadInternal(segments:Array<Segment>):Promise<void>;
    query(bbox:BBox):Promise<Array<string>>;
}