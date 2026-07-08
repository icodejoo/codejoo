@echo off
git remote set-url origin let188@let188-ap-southeast-1.devops.alibabacloudcs.com:codeup/codejoo.git
git remote set-url --add --push origin let188@let188-ap-southeast-1.devops.alibabacloudcs.com:codeup/codejoo.git
git remote set-url --add --push origin https://github.com/icodejoo/codejoo.git
echo Remotes configured:
git remote -v
