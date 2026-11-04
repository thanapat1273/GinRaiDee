# Postgres 17 + pgvector (dish similarity) + PostGIS (distance queries).
# Starts from the pgvector image (current Debian) and adds PostGIS from the PGDG repo;
# the postgis/postgis:17 image is built on bullseye, whose PGDG repo has been retired.
FROM pgvector/pgvector:pg17
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-postgis-3 postgresql-17-postgis-3-scripts \
 && rm -rf /var/lib/apt/lists/*
