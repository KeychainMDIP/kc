SERVICE=hypr-mediator
CID=$(docker compose ps -q "$SERVICE")
if [ -z "$CID" ]; then
  echo "No running container for service: $SERVICE"
  docker compose ps
  exit 1
fi

while :; do
  echo "$(date -Is),$(docker stats --no-stream --format '{{.MemUsage}}' "$CID")"
  sleep 1
done | tee /tmp/${SERVICE}-mem.csv
