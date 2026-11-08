#!/usr/bin/env bash
# Generates the soft background music bed (public/music/bed.mp3) with ffmpeg: four slow chords that swell
# in and out every 6 s, so chord changes happen at silence (no clicks). Nothing to license.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/music
E="pow(sin(PI*mod(t,6)/6),0.7)"
F1="if(lt(mod(t,24),6),220,if(lt(mod(t,24),12),174.61,if(lt(mod(t,24),18),196,164.81)))"
F2="if(lt(mod(t,24),6),261.63,if(lt(mod(t,24),12),220,if(lt(mod(t,24),18),246.94,207.65)))"
F3="if(lt(mod(t,24),6),329.63,if(lt(mod(t,24),12),261.63,if(lt(mod(t,24),18),293.66,246.94)))"
ffmpeg -y -loglevel error -f lavfi -i "aevalsrc='0.06*$E*(sin(2*PI*$F1*t)+sin(2*PI*$F2*t)+0.7*sin(2*PI*$F3*t)+0.5*sin(PI*$F1*t))|0.06*$E*(sin(2*PI*$F1*1.003*t)+sin(2*PI*$F2*1.002*t)+0.7*sin(2*PI*$F3*1.004*t)+0.5*sin(PI*$F1*1.003*t))':s=48000:d=110" \
  -af "lowpass=f=1200,aecho=0.8:0.75:180|360:0.35|0.25,afade=t=in:st=0:d=2" -c:a libmp3lame -b:a 128k public/music/bed.mp3
echo "wrote public/music/bed.mp3"
