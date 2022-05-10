import json
import time
from dataclasses import dataclass, asdict
from math import inf

from pykafka import KafkaClient, Topic


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
            time=time.time(),
            lng=float(data_list[2]),
            lat=float(data_list[3])
        )
        return p
    except Exception as e:
        print("current:", s, flush=True)
        return TrajectoryPoint(
            "-1", time.time(), 0, 0
        )


def main():
    client = KafkaClient(hosts="127.0.0.1:9092")
    topic: Topic = client.topics['my.test']
    with open("/home/liontao/work/mista/data/filtered/all.txt") as fp:
        s = fp.readline()
        with topic.get_sync_producer(delivery_reports=True) as producer:
            while s:
                p = str_to_TrajectoryPoint(s.strip())
                producer.produce(json.dumps(asdict(p)), p.id)
