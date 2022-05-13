from copyreg import pickle
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
from flask_dapr.app import DaprApp
import pickle



@dataclass(eq=True, frozen=True)
class TrajectoryPoint:
    id: str = ""
    t: float = time.time()
    lng: float = inf
    lat: float = inf


@dataclass(eq=True, frozen=True)
class TrajectorySegment:
    id: str = ""
    start: TrajectoryPoint = None
    end: TrajectoryPoint = None


app = Flask(__name__)
dapr = DaprApp(app)

dapr_host = global_settings.DAPR_RUNTIME_HOST
dapr_port = global_settings.DAPR_HTTP_PORT
store_name = "trajectory"
PORT=3011 


@dataclass
class Payload:
    target: List[List[float]]
    candidates: List[str]


@app.route('/hausdorff', methods=['POST'])
def compute():
    message = from_dict(Payload, json.loads(request.data.decode('utf-8')))
    res = calculate_hausdorff(message)
    return jsonify(res), 200


def calculate_hausdorff(msg:Payload) -> List[Dict[str, float]]:
    target = np.array([[i[0], i[1]] for i in msg.target])
    query = f'''{{
        "filter": {{
                "IN": {{"id": [{','.join(map(lambda x:f'"{x}"',set(msg.candidates)))}] }}
        }},
        "sort": [
            {{
                "key": "time"
            }}
        ]
    }}'''
    with DaprClient() as d:
        candidate_trajectories = d.query_state(store_name, query).results
            
    bucket:Dict[str,List[List[float]]] = dict()
    # make trajectory
    for p in candidate_trajectories:
        point = from_dict(TrajectoryPoint, p.json())
        new_data = bucket.get(point.id,[])
        new_data.append([point.lng, point.lat])
        bucket[point.id]= new_data
    
    try:
        dist = tdist.cdist([target], [np.array(v) for _,v in bucket.items()], metric="hausdorff", type_d="spherical")
    except Exception as e:
        print(e,flush=True)
        print([np.array(v) for _,v in bucket.items()],flush=True)
        return []
    res = list()
    keys = list(bucket.keys())
    for i, d in enumerate(dist[0]):
        candidates_id = keys[i]
        res.append({
            "id": candidates_id,
            "distance": d
        })
    print(res,flush=True)
    return res


if __name__ != '__main__':
    # Redirect Flask logs to Gunicorn logs
    gunicorn_logger = logging.getLogger('gunicorn.error')
    app.logger.handlers = gunicorn_logger.handlers
    app.logger.setLevel(gunicorn_logger.level)
else:
    app.run(debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', PORT )))
