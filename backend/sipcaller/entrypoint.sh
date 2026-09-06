#!/bin/sh
# usage: entrypoint.sh <sip uri> <seconds>
set -e
mkdir -p /out /run/baresip
{ echo "module_path $(dirname "$(dpkg -L baresip-core | grep /g711.so$)")"; cat /etc/baresip/config; } > /run/baresip/config
echo "<sip:caller@127.0.0.1>;regint=0;audio_codecs=opus/48000/2;video_codecs=VP8" > /run/baresip/accounts
exec baresip -f /run/baresip -t "$2" -e "/dial $1"
