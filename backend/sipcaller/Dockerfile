# A scriptable SIP caller for the playwright sipbridge tests: baresip with
# VP8 video, sending a solid orange clip and a 440 Hz tone so the tests can
# recognise its media on the other side, and taking snapshots of what it
# receives. See playwright/sipbridge/.
FROM debian:trixie
RUN apt-get update && apt-get install -y --no-install-recommends \
        baresip-core baresip-ffmpeg ffmpeg netcat-openbsd \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -loglevel error -f lavfi -i color=c=0xff7f00:size=640x480:rate=15 \
        -t 600 -c:v libx264 -pix_fmt yuv420p /orange.mp4
COPY config /etc/baresip/config
COPY entrypoint.sh /entrypoint.sh
WORKDIR /out
ENTRYPOINT ["/entrypoint.sh"]
