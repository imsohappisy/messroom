#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

if [ -d "release/mac/Messroom.app" ]; then
  open "release/mac/Messroom.app"
else
  npm start
fi
