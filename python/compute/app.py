import json
import logging
import os
import time
from dataclasses import dataclass
from math import inf
from typing import List, Dict

import numpy as np
import traj_dist.distance as tdist
from dacite import from_dict
from dapr.clients import DaprClient
from dapr.conf import global_settings
from flask import Flask, request, jsonify


@dataclass(eq=True, frozen=True)
class TrajectoryPoint:
    id: str = ""
    time: float = time.time()
    lng: float = inf
    lat: float = inf


@dataclass(eq=True, frozen=True)
class TrajectorySegment:
    id: str = ""
    start: TrajectoryPoint = None
    end: TrajectoryPoint = None


app = Flask(__name__)

dapr_host = global_settings.DAPR_RUNTIME_HOST
dapr_port = global_settings.DAPR_HTTP_PORT
store_name = "trajectory"


@dataclass
class Payload:
    target: List[List[float]]
    candidates: List[str]


@app.route('/hausdorff', methods=['POST'])
def compute():
    message = from_dict(Payload, json.loads(request.data.decode('utf-8')))
    res = calculate_hausdorff(message)
    return jsonify(res), 200


def calculate_hausdorff(msg) -> List[Dict[str, float]]:
    target = np.array([[i.lng, i.lat] for i in msg.target])
    query = {
        "filter": {
            {
                "IN": {"id": msg.candidates}
            }
        },
        "sort": [
            {
                "key": "time",
            },
            {
                "key": "id",
            },
        ]
    }
    with DaprClient() as d:
        candidate_trajectories = d.query_state(store_name, json.dumps(query)).results
    bucket = dict()
    for candidates in msg.candidates:
        bucket[candidates] = list()
    # make trajectory
    for p in candidate_trajectories:
        point = from_dict(TrajectoryPoint, p.json())
        bucket[point.id].append([point.lng, point.lat])

    bucket = list(bucket.items())
    dist = tdist.cdist(target, np.array(map(lambda x: x[1], bucket)), metric="hausdorf", type_d="spherical")
    res = list()
    for i, d in enumerate(dist):
        candidates_id = bucket[i][0]
        res.append({
            "id": candidates_id,
            "distance": d
        })
    return res


if __name__ != '__main__':
    # Redirect Flask logs to Gunicorn logs
    gunicorn_logger = logging.getLogger('gunicorn.error')
    app.logger.handlers = gunicorn_logger.handlers
    app.logger.setLevel(gunicorn_logger.level)
else:
    app.run(debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', global_settings.HTTP_APP_PORT)))
