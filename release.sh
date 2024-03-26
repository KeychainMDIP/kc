git checkout release
git pull
git merge main
git push
git checkout main

docker compose build
docker push macterra/gatekeeper
docker push macterra/hyperswarm-mediator
