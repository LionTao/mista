# Distributed Index

Core component of MiSTA. With Dapr actor model, here we build a distributed grid partition using H3 as global index. Inside each partition, we build a traditional R-Tree to do fine-tune search.

