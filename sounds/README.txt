Pune aici fișierul de sunet pentru alerta de depășire a vitezei, cu
numele exact:

    overspeed.mp3

(format MP3 sau WAV, un beep scurt e suficient -- exact ca beep1.mp3/
beep2.mp3 din Trucky). Dacă preferi alt format, actualizează calea din
renderer/app.js (elementul <audio id="alert-sound">) și main/soundAlerts.js
după caz.

Dacă fișierul lipsește, aplicația nu se blochează -- pur și simplu nu se
aude nimic la depășirea vitezei, dar restul alertei (verificarea limitei)
funcționează normal.
