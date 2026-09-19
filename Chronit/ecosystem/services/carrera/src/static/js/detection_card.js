/* ============================================================
   CHRONIT - CARD DE DETECCIÓN DE PILOTO (componente compartido)
   ------------------------------------------------------------
   Muestra una card individual grande cuando un piloto es
   detectado por el decoder (cruce de meta / vuelta contada).

   Reglas:
   - Dura 2 segundos o hasta que OTRO piloto sea detectado
     (lo que ocurra primero).
   - Si dos pilotos son detectados casi al mismo tiempo, se
     muestra el más reciente.
   - Se alimenta con el mismo objeto que devuelve
     /api/dashboard/full-data, por lo que NO interfiere con la
     actualización normal de la tabla.

   Uso (tanto en "Pantalla en Pista" como en el tablero público):
     ChronitDetectionCard.init();
     ChronitDetectionCard.handleFullData(fullData);
   ============================================================ */
(function () {
    'use strict';

    // Tiempo que la card permanece visible (ms).
    var VISIBLE_MS = 2000;

    // La card SOLO se muestra en la pantalla en pista (panel LED).
    // En el resto de paneles del módulo de sistemas se mantiene deshabilitada.
    function isLedPanel() {
        return !!(document.body && document.body.classList.contains('pantalla-pista'));
    }

    var cardEl = null;
    var hideTimer = null;
    // driver_id -> firma de la última detección conocida
    var signatures = {};
    // Evita disparar la card en la primera carga (solo guarda línea base)
    var baselineReady = false;

    function fallbackPhoto() {
        return '/static/default-avatar.png';
    }

    // Normaliza la ruta de la foto tomando siempre el nombre base.
    // (Equivalente a driverPhotoUrl() del dashboard, pero autocontenido
    // para que este componente funcione sin depender de dashboard.js.)
    function photoUrl(photo) {
        if (!photo) return fallbackPhoto();
        var clean = String(photo).split('?')[0].split('#')[0];
        var parts = clean.split('/').filter(Boolean);
        var name = parts.length ? parts[parts.length - 1] : '';
        try { name = decodeURIComponent(name); } catch (e) { /* usar tal cual */ }
        if (!name || name === 'default-avatar.png') return fallbackPhoto();
        return '/static/uploads/drivers/' + encodeURIComponent(name);
    }

    function formatClock(totalSeconds) {
        if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds)) {
            return '--:--.---';
        }
        var safe = Math.max(0, Number(totalSeconds) || 0);
        var totalMillis = Math.round(safe * 1000);
        var millis = totalMillis % 1000;
        var totalSecondsInt = Math.floor(totalMillis / 1000);
        var seconds = totalSecondsInt % 60;
        var minutes = Math.floor((totalSecondsInt % 3600) / 60);
        var hours = Math.floor(totalSecondsInt / 3600);
        var formatted = String(minutes).padStart(2, '0') + ':' +
            String(seconds).padStart(2, '0') + '.' +
            String(millis).padStart(3, '0');
        return hours > 0 ? String(hours).padStart(2, '0') + ':' + formatted : formatted;
    }

    function ensureElement() {
        if (cardEl && document.body.contains(cardEl)) return cardEl;

        cardEl = document.getElementById('driverDetectionCard');
        if (!cardEl) {
            cardEl = document.createElement('div');
            cardEl.id = 'driverDetectionCard';
            cardEl.className = 'driver-detection-card';
            cardEl.setAttribute('aria-live', 'polite');
            cardEl.innerHTML =
                '<div class="ddc-photo-wrap">' +
                    '<img class="ddc-photo" id="ddcPhoto" src="' + fallbackPhoto() + '" alt="Piloto detectado">' +
                '</div>' +
                '<div class="ddc-info">' +
                    '<div class="ddc-name" id="ddcName">--</div>' +
                    '<div class="ddc-metrics">' +
                        '<div class="ddc-metric"><span class="ddc-label">VUELTA</span><span class="ddc-value" id="ddcLap">--</span></div>' +
                        '<div class="ddc-metric"><span class="ddc-label">TIEMPO</span><span class="ddc-value" id="ddcTime">--</span></div>' +
                        '<div class="ddc-metric"><span class="ddc-label">VELOCIDAD</span><span class="ddc-value" id="ddcSpeed">--</span></div>' +
                        '<div class="ddc-metric"><span class="ddc-label">POSICIÓN</span><span class="ddc-value" id="ddcPos">--</span></div>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(cardEl);
        }
        return cardEl;
    }

    function init() {
        if (!isLedPanel()) return;
        ensureElement();
    }

    function hide() {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        var el = cardEl || document.getElementById('driverDetectionCard');
        if (el) el.classList.remove('visible');
    }

    function show(driver, session, speeds) {
        if (!driver) return;

        var el = ensureElement();
        var name = driver.full_name || driver.name || 'Piloto';
        var laps = driver.total_laps || 0;
        var lapsLimit = (session && session.laps_limit) || 0;

        // Tiempo de registro: última vuelta; si no hay, tiempo total individual.
        var lapTime = '--';
        if (driver.last_lap != null && driver.last_lap > 0) {
            lapTime = formatClock(driver.last_lap);
        } else if (driver.real_total_time != null && driver.real_total_time > 0) {
            lapTime = formatClock(driver.real_total_time);
        }

        var speedRaw = (speeds && speeds[driver.driver_id] != null)
            ? speeds[driver.driver_id]
            : driver.avg_speed_kmh;
        var speed = (speedRaw && speedRaw > 0 && speedRaw < 400)
            ? Math.round(speedRaw) + ' km/h'
            : '--';

        var set = function (id, txt) {
            var node = document.getElementById(id);
            if (node) node.textContent = txt;
        };
        set('ddcName', name);
        set('ddcLap', laps + '/' + lapsLimit);
        set('ddcTime', lapTime);
        set('ddcSpeed', speed);
        set('ddcPos', driver.position ? ('P' + driver.position) : '--');

        var img = document.getElementById('ddcPhoto');
        if (img) {
            img.onerror = function () { this.src = fallbackPhoto(); };
            img.src = photoUrl(driver.photo);
        }

        // Reiniciar el temporizador: la card dura 2 s o hasta la próxima detección.
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        el.classList.remove('visible');
        void el.offsetWidth; // reinicia la animación de entrada
        el.classList.add('visible');
        hideTimer = setTimeout(hide, VISIBLE_MS);
    }

    // Firma que identifica una detección: cambia si el piloto completa
    // una vuelta o si el decoder registra una nueva lectura (last_detection).
    function signatureOf(driver) {
        return [
            driver.total_laps || 0,
            driver.last_lap || 0,
            driver.last_detection || ''
        ].join('|');
    }

    function handleFullData(fullData) {
        if (!isLedPanel()) return;

        ensureElement();

        // Sin carrera activa: reiniciar línea base y ocultar la card.
        if (!fullData || !fullData.active) {
            signatures = {};
            baselineReady = false;
            hide();
            return;
        }

        var session = fullData.session || {};
        var leaderboard = fullData.leaderboard || [];
        var speeds = fullData.speeds || {};

        var nextSignatures = {};
        var detected = null;
        var detectedTs = -Infinity;

        leaderboard.forEach(function (driver) {
            var sig = signatureOf(driver);
            nextSignatures[driver.driver_id] = sig;

            if (!baselineReady) return;              // primer poll: solo línea base
            var prev = signatures[driver.driver_id];
            if (prev === undefined) return;          // piloto nuevo: no dispara
            if (prev === sig) return;                // sin cambios

            // Entre varios detectados en el mismo poll, mostrar el más reciente.
            var ts = driver.last_detection ? Date.parse(driver.last_detection) : NaN;
            var tsValue = isNaN(ts) ? (driver.total_laps || 0) : ts;
            if (tsValue >= detectedTs) {
                detectedTs = tsValue;
                detected = driver;
            }
        });

        signatures = nextSignatures;

        if (!baselineReady) {
            baselineReady = true;
            return;
        }

        if (detected) show(detected, session, speeds);
    }

    window.ChronitDetectionCard = {
        init: init,
        handleFullData: handleFullData,
        show: show,
        hide: hide
    };

    // Auto-inicialización (el script se carga al final del <body>).
    if (document.body) {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
