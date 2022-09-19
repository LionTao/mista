import json
import time
from dataclasses import dataclass, asdict
from math import inf
from kafka import KafkaProducer
from cloudevents.http import CloudEvent, to_json





@dataclass(eq=True, frozen=True)
class TrajectoryPoint:
    id: str = ""
    time: float = inf
    lng: float = inf
    lat: float = inf


def str_to_TrajectoryPoint(s: str) -> TrajectoryPoint:
    data_list = s.strip().split(",")
    try:
        p = TrajectoryPoint(
            id=data_list[0],
            time=round(time.time() * 1000),
            lng=float(data_list[2]),
            lat=float(data_list[3])
        )
        return p
    except Exception as e:
        print("current:", s, flush=True)
        return TrajectoryPoint(
            "-1", round(time.time() * 1000), 0, 0
        )


def main():
    client = KafkaProducer(bootstrap_servers=["192.168.0.55:9092"])
    with open("/home/liontao/work/mista/data/all.txt") as fp:
        s = fp.readline()    
        while s:
            p = str_to_TrajectoryPoint(s.strip())
            attributes = {
                "type": "com.example.sampletype1",
                "source": "https://example.com/event-producer",
            }
            event = CloudEvent(attributes, asdict(p))
            body = to_json(event)
            client.send(topic="point",value = body, key = p.id.encode('ascii'),headers=[("Content-Type","application/json".encode("ascii"))])
            # client.send(topic="point",value = body, key = "1".encode("ascii")).
            s = fp.readline()

if __name__ == '__main__':
    main()
