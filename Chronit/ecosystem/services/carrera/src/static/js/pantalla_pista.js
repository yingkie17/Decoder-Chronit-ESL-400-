/* ============================================================
   PANTALLA EN PISTA - lógica de datos y vistas (vista sin menús)
   ------------------------------------------------------------
   * Consume los mismos endpoints que el tablero público
     (/api/dashboard/full-data y /api/session/current/podium).
   * Tiempo real por WebSocket (Socket.IO): la tabla se refresca
     al instante con 'dashboard_update' y la cuenta regresiva se
     sincroniza con 'countdown_config' / 'countdown_start'.
   * El polling REST queda solo como respaldo (se espacia cuando
     el WebSocket está conectado para no saturar el servidor).
   * Vistas: Tabla, Podio y Clasificación por grupos, con
     auto-rotación, teclas y botones discretos.
   ============================================================ */
(function () {
    'use strict';

    var POLL_MS = 500;          // Respaldo cuando NO hay WebSocket
    var SAFETY_POLL_MS = 3000;  // Respaldo cuando el WebSocket está activo
    var PODIUM_POLL_MS = 5000;  // Podio/grupos: baja frecuencia (cambian lento)
    var FULL_DATA_URL = '/api/dashboard/full-data';
    var PODIUM_URL = '/api/session/current/podium';
    var DEFAULT_PHOTO = '/static/default-avatar.png';

    var AUTO_ROTATE_MS = 12000;      // Rotación automática entre vistas
    var MANUAL_PAUSE_MS = 30000;     // Tras interacción manual, pausa la rotación
    var FINISH_SPLASH_MS = 5000;     // Duración del splash "¡PARE!" al finalizar

    // Columnas configurables de ESTA pantalla (id = misma clave que el panel).
    var LED_COLUMNS = [
        { id: 'pos', cls: 'k-col-pos' },
        { id: 'vueltas', cls: 'k-col-vueltas' },
        { id: 'dif', cls: 'k-col-dif' },
        { id: 'mejor', cls: 'k-col-mejor' },
        { id: 'tiempo', cls: 'k-col-tiempo' },
        { id: 'ttotal', cls: 'k-col-tiempo-individual' },
        { id: 'vel', cls: 'k-col-velocidad' },
        { id: 'kart', cls: 'k-col-kart' }
    ];

    var DRIVER_COLORS = [
        '#ff9800', '#03a9f4', '#9c27b0', '#00bcd4', '#4caf50',
        '#ffeb3b', '#2196f3', '#ff5722', '#673ab7', '#e91e63',
        '#00e5ff', '#76ff03', '#ffc400', '#ff7043', '#ab47bc',
        '#00acc1', '#c0ca33', '#ec407a', '#42a5f5', '#26a69a'
    ];

    var raceTimerState = { seconds: 0, status: 'pending', lastSyncMs: Date.now() };

    // Estado de configuración / vistas / tiempo real.
    var countdownConfig = { duration: 10, speed: 1.0 };
    var hiddenLedColumns = [];
    var currentView = 'tabla';
    var lastSessionStatus = 'pending';
    var hasPodium = false;
    var hasGroups = false;
    var manualPauseUntil = 0;
    var pollTimer = null;
    var rotationTimer = null;
    var isCountingDown = false;
    var lastCountdownId = 0;
    var socket = null;

    // Splash de fin de carrera: se muestra una única vez por sesión, al
    // detectar la transición a 'completed', y da paso al podio.
    var lastFinishSessionId = null;
    var isFinishing = false;
    var finishTimer = null;

    // ------------------------- Helpers -------------------------
    function driverPhotoUrl(photo) {
        if (!photo) return DEFAULT_PHOTO;
        var clean = String(photo).split('?')[0].split('#')[0];
        var parts = clean.split('/').filter(Boolean);
        var name = parts.length ? parts[parts.length - 1] : '';
        try { name = decodeURIComponent(name); } catch (e) { /* noop */ }
        if (!name || name === 'default-avatar.png') return DEFAULT_PHOTO;
        return '/static/uploads/drivers/' + encodeURIComponent(name);
    }

    function formatRaceClock(totalSeconds) {
        if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds)) {
            return '00:00.000';
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

    function normalizeRaceMode(value) {
        var v = String(value || '').trim().toLowerCase();
        if (v === 'time_attack' || v === 'time-attack' || v === 'timeattack' || v === 'ta') return 'time_attack';
        if (v === 'classification' || v === 'clasificacion' || v === 'class' || v === 'cl') return 'classification';
        if (v === 'endurance' || v === 'enduro' || v === 'en') return 'endurance';
        if (v === 'qualifying_laps' || v === 'qualifying' || v === 'quali_laps' || v === 'ql' || v === 'clasificacion_vueltas') return 'qualifying_laps';
        return 'position';
    }

    function raceModeLabel(mode) {
        var m = normalizeRaceMode(mode);
        if (m === 'time_attack') return 'TIME ATTACK';
        if (m === 'classification') return 'CLASIF. POR TIEMPO (mejor T. de Total de vueltas)';
        if (m === 'endurance') return 'ENDURANCE';
        if (m === 'qualifying_laps') return 'CLASIF. POR VUELTAS (mejor T. solo ultima vuelta';
        return 'CARRERA';
    }

    function raceModeDescription(mode) {
        var m = normalizeRaceMode(mode);
        if (m === 'time_attack') return '⏱️ TIME ATTACK: Gana el piloto con el menor tiempo acumulado completando TODAS las vueltas. Los que no completen todas las vueltas quedan DESCLASIFICADOS (DNQ).';
        if (m === 'classification') return '🏁 CLASIFICACIÓN: Gana el piloto con la MEJOR vuelta dentro del tiempo límite.';
        if (m === 'endurance') return '🏆 ENDURANCE: Gana el piloto con MÁS vueltas completadas en el tiempo límite. Desempate: menor tiempo acumulado.';
        if (m === 'qualifying_laps') return '🏁 CLASIF. POR VUELTAS: Cada piloto tiene N vueltas para marcar su mejor tiempo. La primera señal es vuelta de salida (no cuenta). Se clasifica por mejor vuelta. Al finalizar se pueden crear grupos Q1/Q2/Q3.';
        return '🏎️ CARRERA: Gana el primero en cruzar la meta después de completar todas las vueltas.';
    }

    function fetchJson(url) {
        return fetch(url, { headers: { 'Content-Type': 'application/json' } })
            .then(function (res) { return res.ok ? res.json() : null; })
            .catch(function () { return null; });
    }

    function postJson(url) {
        // Devuelve el cuerpo también en respuestas de error para poder
        // informar del motivo (p. ej. decoder no conectado) al iniciar.
        return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(function (res) { return res.json().catch(function () { return null; }); })
            .catch(function () { return null; });
    }

    function setText(id, txt) {
        var el = document.getElementById(id);
        if (el) el.innerText = txt;
    }

    // ----------------------- Render tabla -----------------------
    function renderClock() {
        var el = document.getElementById('total_time');
        if (!el) return;
        var seconds = raceTimerState.seconds;
        if (raceTimerState.status === 'active') {
            seconds += (Date.now() - raceTimerState.lastSyncMs) / 1000;
        }
        el.innerText = formatRaceClock(seconds);
        el.classList.remove('status-pending', 'status-active', 'status-paused', 'status-completed', 'status-timeout');
        el.classList.add('status-' + raceTimerState.status);
    }

    function renderEmpty() {
        var lista = document.getElementById('lista-pilotos');
        if (lista) lista.innerHTML = '';
        setText('publicRaceNameDisplay', '--');
        setText('publicRaceModeDisplay', '--');
        setText('publicRaceDescriptionDisplay', '--');
        var badge = document.getElementById('raceStatusBadge');
        if (badge) {
            badge.innerText = '⏳ PENDIENTE';
            badge.classList.remove('status-active', 'status-paused', 'status-completed');
            badge.classList.add('status-pending');
        }
    }

    function renderHeader(session) {
        setText('publicRaceNameDisplay', session.circuit_name || 'Sin carrera');
        setText('publicRaceModeDisplay', 'Modo: ' + raceModeLabel(session.race_mode));
        setText('publicRaceDescriptionDisplay', raceModeDescription(session.race_mode));

        var badge = document.getElementById('raceStatusBadge');
        if (badge) {
            var status = session.status || 'pending';
            badge.classList.remove('status-pending', 'status-active', 'status-paused', 'status-completed');
            if (status === 'active') { badge.innerText = '🏁 EN CURSO'; badge.classList.add('status-active'); }
            else if (status === 'paused') { badge.innerText = '⏸️ PAUSADA'; badge.classList.add('status-paused'); }
            else if (status === 'completed') { badge.innerText = '🏆 FINALIZADA'; badge.classList.add('status-completed'); }
            else { badge.innerText = '⏳ PENDIENTE'; badge.classList.add('status-pending'); }
        }
    }

    function renderRows(session, leaderboard, speedsMap) {
        var listaPilotos = document.getElementById('lista-pilotos');
        if (!listaPilotos) return;

        if (!leaderboard || !leaderboard.length) {
            listaPilotos.innerHTML = '';
            return;
        }

        var raceMode = normalizeRaceMode(session.race_mode);

        var totalTime = '--';
        if (session.race_elapsed_seconds !== undefined && session.race_elapsed_seconds !== null) {
            var seconds = session.race_elapsed_seconds;
            if (session.status === 'active') {
                seconds += (Date.now() - raceTimerState.lastSyncMs) / 1000;
            }
            totalTime = formatRaceClock(seconds);
        }

        listaPilotos.innerHTML = leaderboard.map(function (driver, idx) {
            var color = DRIVER_COLORS[idx % DRIVER_COLORS.length];
            var best = (driver.best_lap != null && driver.best_lap > 0) ? formatRaceClock(driver.best_lap) : '--';

            var calculatedTotalTime = '--';
            if (driver.real_total_time && driver.real_total_time > 0) {
                calculatedTotalTime = formatRaceClock(driver.real_total_time);
            }

            var tiempoPrincipal = '--';
            var tiempoSecundario = '--';

            if (raceMode === 'time_attack') {
                tiempoPrincipal = (driver.race_total_time != null && driver.race_total_time > 0)
                    ? formatRaceClock(driver.race_total_time) : '--';
                var tiempoTranscurrido = '--';
                if (driver.first_detection) {
                    var firstDetMs = new Date(driver.first_detection).getTime();
                    if (!isNaN(firstDetMs)) {
                        if (driver.is_finished && driver.race_total_time != null && driver.race_total_time > 0) {
                            tiempoTranscurrido = formatRaceClock(driver.race_total_time);
                        } else {
                            var elapsedSec = (Date.now() - firstDetMs) / 1000;
                            tiempoTranscurrido = elapsedSec > 0 ? formatRaceClock(elapsedSec) : '--';
                        }
                    }
                }
                tiempoSecundario = tiempoTranscurrido;
            } else if (raceMode === 'classification') {
                tiempoPrincipal = driver.best_lap ? formatRaceClock(driver.best_lap) : '--';
                tiempoSecundario = (driver.total_laps || 0) + ' v';
            } else if (raceMode === 'endurance') {
                tiempoPrincipal = (driver.total_laps || 0) + ' v';
                tiempoSecundario = driver.best_lap ? formatRaceClock(driver.best_lap) : '--';
            } else {
                if (driver.is_finished && driver.total_time != null) {
                    tiempoPrincipal = formatRaceClock(driver.total_time);
                } else {
                    tiempoPrincipal = calculatedTotalTime;
                }
                tiempoSecundario = totalTime;
            }

            var speed = speedsMap[driver.driver_id];
            var speedValue = (speed && speed > 0 && speed < 400) ? String(Math.round(speed)) : '--';

            var rowClass = idx === 0 ? 'row-first' : '';
            var progressLineClass = idx === 0 ? 'line-gold' : 'line-blue';
            var kartLabel = driver.kart_id ? driver.kart_id : (driver.transponder_id || '--');
            var photoUrl = driverPhotoUrl(driver.photo);

            var cupIcon = '';
            if (raceMode === 'time_attack') {
                if (session.status === 'completed') {
                    if (idx === 0) cupIcon = ' 🏆';
                    else if (idx === 1) cupIcon = ' 🥈';
                    else if (idx === 2) cupIcon = ' 🥉';
                }
            } else if (driver.is_finished && driver.total_laps >= (session.laps_limit || 0)) {
                if (idx === 0) cupIcon = ' 🏆';
                else if (idx === 1) cupIcon = ' 🥈';
                else if (idx === 2) cupIcon = ' 🥉';
            }

            return '' +
                '<div class="k-row ' + rowClass + '">' +
                    '<div class="k-col-pos">' + (driver.position || (idx + 1)) + '</div>' +
                    '<div class="k-col-name">' +
                        '<img src="' + photoUrl + '" class="driver-photo-leaderboard" onerror="this.src=\'' + DEFAULT_PHOTO + '\'">' +
                        '<span class="driver-name">' + (driver.full_name || driver.name) + cupIcon + '</span>' +
                        '<div class="progress-line ' + progressLineClass + '" style="background: linear-gradient(90deg, ' + color + ', transparent);"></div>' +
                    '</div>' +
                    '<div class="k-col-vueltas">' + (driver.total_laps || 0) + '/' + (session.laps_limit || 0) + '</div>' +
                    '<div class="k-col-dif"><span class="time-box box-black">' + (driver.gap || (idx === 0 ? 'Líder' : '--')) + '</span></div>' +
                    '<div class="k-col-mejor"><span class="time-box box-gold">' + best + '</span></div>' +
                    '<div class="k-col-tiempo"><span class="time-box box-black">' + tiempoSecundario + '</span></div>' +
                    '<div class="k-col-tiempo-individual"><span class="time-box box-black">' + tiempoPrincipal + '</span></div>' +
                    '<div class="k-col-velocidad">' +
                        '<span class="time-box box-black">' + speedValue +
                        ' <span style="color: yellow; font-size: 0.6rem; margin-left: 2px;">km/h</span></span>' +
                    '</div>' +
                    '<div class="k-col-kart"><span class="kart-circle" style="background-color: ' + color + ';">' + kartLabel + '</span></div>' +
                '</div>';
        }).join('');

        // Las filas se regeneran: reaplicar la configuración de columnas de pista.
        applyLedColumns();
    }

    // ---------------- Configuración de columnas (LED) ----------------
    function applyLedColumns() {
        var container = document.getElementById('view-tabla');
        if (!container) return;
        LED_COLUMNS.forEach(function (col) {
            var hidden = hiddenLedColumns.indexOf(col.id) !== -1;
            var headers = container.querySelectorAll('.k-header .' + col.cls);
            headers.forEach(function (el) { el.style.display = hidden ? 'none' : ''; });
            var cells = container.querySelectorAll('#lista-pilotos .k-row .' + col.cls);
            cells.forEach(function (el) { el.style.display = hidden ? 'none' : ''; });
        });
    }

    function loadLedColumnsConfig() {
        fetchJson('/api/columns/config').then(function (res) {
            if (res && res.success) {
                hiddenLedColumns = res.led || [];
            } else {
                hiddenLedColumns = [];
            }
            applyLedColumns();
        });
    }

    // --------------------------- VISTAS ---------------------------
    function setView(name, manual) {
        if (['tabla', 'podio', 'grupos'].indexOf(name) === -1) name = 'tabla';
        currentView = name;
        ['tabla', 'podio', 'grupos'].forEach(function (v) {
            var el = document.getElementById('view-' + v);
            if (el) el.style.display = (v === name) ? '' : 'none';
        });
        document.querySelectorAll('.pista-ctl-btn[data-view]').forEach(function (btn) {
            btn.classList.toggle('is-active', btn.getAttribute('data-view') === name);
        });
        if (manual) {
            manualPauseUntil = Date.now() + MANUAL_PAUSE_MS;
        }
        if (name === 'podio' || name === 'grupos') {
            loadPodiumData();
        }
    }

    // Carrera "en curso": activa, pausada o pendiente esperando iniciar.
    // En estos estados la tabla no debe ser tapada por el carrusel.
    function isRaceLive() {
        return lastSessionStatus === 'active' ||
               lastSessionStatus === 'paused' ||
               lastSessionStatus === 'pending';
    }

    function availableViews() {
        // Con carrera en curso solo se muestra la tabla (no tapar el live).
        if (isRaceLive()) return ['tabla'];
        var views = ['tabla'];
        if (hasPodium) views.push('podio');
        if (hasGroups) views.push('grupos');
        return views;
    }

    function rotateView() {
        // El carrusel (tabla → podio → grupos) solo rota cuando NO hay carrera
        // activa ni pendiente esperando iniciar, ni se está mostrando el splash
        // de fin de carrera. Durante la carrera se queda en la tabla para no
        // tapar el live.
        if (isFinishing || isRaceLive() || Date.now() < manualPauseUntil) return;
        var views = availableViews();
        if (views.length < 2) return;
        var idx = views.indexOf(currentView);
        var next = views[(idx + 1) % views.length];
        setView(next);
    }

    // --------------------------- PODIO ---------------------------
    function podiumStat(driver, mode) {
        if (mode === 'classification' || mode === 'qualifying_laps') {
            return driver.best_lap ? ('Mejor: ' + formatRaceClock(driver.best_lap)) : '--';
        }
        if (mode === 'endurance') {
            return (driver.total_laps || 0) + ' vueltas';
        }
        if (mode === 'time_attack') {
            return (driver.race_total_time > 0) ? ('Total: ' + formatRaceClock(driver.race_total_time)) : ((driver.total_laps || 0) + ' vueltas');
        }
        if (driver.total_time != null && driver.total_time > 0) {
            return 'Total: ' + formatRaceClock(driver.total_time);
        }
        return (driver.total_laps || 0) + ' vueltas';
    }

    function renderPodium(data) {
        var cont = document.getElementById('pistaPodium');
        if (!cont) return;
        var podium = (data && data.podium) ? data.podium : [];
        hasPodium = podium.length > 0;

        if (!podium.length) {
            cont.innerHTML = '<div class="pista-empty">Sin resultados de podio todavía.</div>';
            return;
        }

        var mode = normalizeRaceMode(data.race_mode);
        var medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
        // Orden visual: 2º - 1º - 3º
        var slots = [];
        slots[1] = podium[0];
        slots[0] = podium[1];
        slots[2] = podium[2];

        cont.innerHTML = slots.map(function (driver, visualIdx) {
            if (!driver) return '';
            var place = visualIdx === 1 ? 1 : (visualIdx === 0 ? 2 : 3);
            var color = DRIVER_COLORS[place - 1];
            return '' +
                '<div class="podium-slot p' + place + '">' +
                    '<div class="podium-medal">' + (medals[place] || place) + '</div>' +
                    '<img class="podium-photo" src="' + driverPhotoUrl(driver.photo) + '" onerror="this.src=\'' + DEFAULT_PHOTO + '\'">' +
                    '<div class="podium-name">' + (driver.full_name || driver.name || '--') + '</div>' +
                    '<div class="podium-stat">' + podiumStat(driver, mode) + '</div>' +
                    '<div class="podium-base" style="background: linear-gradient(180deg, ' + color + ', rgba(0,0,0,0.15));">' + place + '</div>' +
                '</div>';
        }).join('');
    }

    // --------------------------- GRUPOS ---------------------------
    function renderGroups(data) {
        var cont = document.getElementById('pistaGroups');
        if (!cont) return;
        var groups = data ? data.classification_groups : null;
        hasGroups = !!(groups && ((groups.q1 && groups.q1.length) || (groups.q2 && groups.q2.length) ||
            (groups.q3 && groups.q3.length) || (groups.dnq && groups.dnq.length)));

        if (!groups) {
            cont.innerHTML = '<div class="pista-empty">El modo de carrera actual no genera grupos de clasificación (Q1/Q2/Q3).</div>';
            return;
        }
        if (!hasGroups) {
            cont.innerHTML = '<div class="pista-empty">Aún no hay pilotos clasificados con vueltas registradas.</div>';
            return;
        }

        var defs = [
            { key: 'q1', title: 'GRUPO Q1', cls: 'g-q1' },
            { key: 'q2', title: 'GRUPO Q2', cls: 'g-q2' },
            { key: 'q3', title: 'GRUPO Q3', cls: 'g-q3' },
            { key: 'dnq', title: 'NO CLASIFICADOS (DNQ)', cls: 'g-dnq' }
        ];

        cont.innerHTML = defs.map(function (def) {
            var list = groups[def.key] || [];
            var rows = list.length ? list.map(function (d, i) {
                return '<div class="group-row">' +
                    '<span class="group-pos">' + (i + 1) + '</span>' +
                    '<span class="group-name">' + (d.full_name || d.name || '--') + '</span>' +
                    '<span class="group-laps">' + (d.total_laps || 0) + ' v</span>' +
                    '</div>';
            }).join('') : '<div class="group-empty">—</div>';
            return '<div class="group-card ' + def.cls + '">' +
                '<div class="group-title">' + def.title + '</div>' +
                '<div class="group-list">' + rows + '</div>' +
                '</div>';
        }).join('');
    }

    // --------------------- CARGA de podio/grupos ---------------------
    function loadPodiumData() {
        return fetchJson(PODIUM_URL).then(function (data) {
            if (!data || !data.active) {
                hasPodium = false;
                hasGroups = false;
                renderPodium({ podium: [] });
                renderGroups(null);
                return;
            }
            renderPodium(data);
            renderGroups(data);
        });
    }

    // ------------------------- Carga tabla ---------------------------
    function renderFromPayload(full) {
        if (window.ChronitDetectionCard) {
            window.ChronitDetectionCard.handleFullData(full);
        }

        // Respaldo por polling de la cuenta regresiva (por si se perdió el WS).
        checkCountdownState(full);

        if (!full || !full.active) {
            lastSessionStatus = 'idle';
            raceTimerState = { seconds: 0, status: 'idle', lastSyncMs: Date.now() };
            renderClock();
            renderEmpty();
            return;
        }

        var session = full.session;
        var leaderboard = full.leaderboard || [];
        var speeds = full.speeds || {};

        var prevStatus = lastSessionStatus;
        lastSessionStatus = session.status || 'pending';

        // Fin de carrera: aviso "¡PARE!" una única vez por sesión, justo en la
        // transición desde carrera en curso (activa/pausada) a 'completed'.
        if (session.status === 'completed' &&
            (prevStatus === 'active' || prevStatus === 'paused') &&
            session.id !== lastFinishSessionId) {
            lastFinishSessionId = session.id;
            showFinishSplash();
        }

        // Si la carrera está en curso (activa/pausada/pendiente) y estábamos en
        // podio/grupos, volver a la tabla para no tapar la carrera.
        if (isRaceLive() && currentView !== 'tabla') {
            setView('tabla');
        }

        raceTimerState = {
            seconds: Number(session.race_elapsed_seconds || 0),
            status: session.status || 'pending',
            lastSyncMs: Date.now()
        };

        renderClock();
        renderHeader(session);
        renderRows(session, leaderboard, speeds);
    }

    function loadData() {
        return fetchJson(FULL_DATA_URL).then(renderFromPayload);
    }

    function startPolling(ms) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(loadData, ms);
    }

    // --------------------- CUENTA REGRESIVA ---------------------
    var audioCtx = null;
    function playBeep(freq, duration, volume) {
        try {
            if (!audioCtx) {
                var Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                audioCtx = new Ctx();
            }
            var osc = audioCtx.createOscillator();
            var gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.value = volume || 0.4;
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            setTimeout(function () { osc.stop(); }, (duration || 0.2) * 1000);
        } catch (e) { /* audio no disponible */ }
    }

    function applyCountdownStyle(n) {
        var el = document.getElementById('pistaCountdownNumber');
        if (!el) return;
        if (n <= 1) {
            el.style.color = '#4caf50';
            el.style.textShadow = '0 0 30px rgba(76, 175, 80, 0.75), 0 0 90px rgba(76, 175, 80, 0.45)';
        } else if (n <= 3) {
            el.style.color = '#ffd700';
            el.style.textShadow = '0 0 30px rgba(255, 215, 0, 0.7), 0 0 90px rgba(255, 215, 0, 0.4)';
        } else {
            el.style.color = '#e5484d';
            el.style.textShadow = '0 0 30px rgba(229, 72, 77, 0.55), 0 0 90px rgba(229, 72, 77, 0.35)';
        }
    }

    var lastCountdownBeep = -1;

    // Cuenta regresiva: el número se calcula SIEMPRE con el reloj LOCAL, a partir
    // del instante en que este dispositivo recibe el aviso. Así no depende de que
    // el reloj de la pantalla LED esté sincronizado con el servidor (un reloj
    // adelantado/atrasado antes congelaba la cuenta). El servidor emite el aviso
    // a todos los dispositivos a la vez, por lo que quedan sincronizados.
    function runCountdown(seconds, speed) {
        var overlay = document.getElementById('pistaCountdownOverlay');
        var numberEl = document.getElementById('pistaCountdownNumber');
        var hintEl = document.getElementById('pistaCountdownHint');
        if (!overlay || !numberEl) return Promise.resolve(false);

        var total = Math.max(1, parseInt(seconds) || 10);
        var stepMs = Math.max(100, (parseFloat(speed) || 1) * 1000);
        var startMs = Date.now();

        overlay.style.display = 'flex';
        lastCountdownBeep = -1;

        return new Promise(function (resolve) {
            function frame() {
                var elapsed = Date.now() - startMs;
                var idx = Math.max(0, Math.floor(elapsed / stepMs));
                var current = total - idx;
                if (current > 0) {
                    if (idx !== lastCountdownBeep) {
                        lastCountdownBeep = idx;
                        if (current <= 3) playBeep(880, 0.25, 0.55); else playBeep(440, 0.12, 0.4);
                    }
                    numberEl.innerText = current;
                    applyCountdownStyle(current);
                    hintEl.innerText = (current <= 3) ? '¡LISTOS!' : 'PREPÁRENSE';
                    setTimeout(frame, 50);
                } else {
                    if (idx !== lastCountdownBeep) {
                        lastCountdownBeep = idx;
                        playBeep(1046, 0.5, 0.7);
                    }
                    numberEl.innerText = '0';
                    applyCountdownStyle(0);
                    hintEl.innerText = '¡GO!';
                    setTimeout(function () {
                        overlay.style.display = 'none';
                        resolve(true);
                    }, 600);
                }
            }
            frame();
        });
    }

    // Punto único de arranque de la cuenta: evita que el mismo aviso dispare la
    // cuenta dos veces (una por WebSocket y otra por polling) gracias al guard
    // isCountingDown y al 'id' incremental del servidor.
    function startCountdownFromSignal(duration, speed, id) {
        if (id) lastCountdownId = id;
        if (isCountingDown) return;
        isCountingDown = true;
        runCountdown(duration || countdownConfig.duration, speed || countdownConfig.speed)
            .then(function () { isCountingDown = false; });
    }

    // Respaldo por polling: si se pierde el evento WebSocket 'countdown_start', el
    // payload del tablero trae el último arranque. Se dispara solo si es nuevo y
    // reciente, para no repetir una cuenta vieja al recargar la pantalla.
    function checkCountdownState(full) {
        var cd = full && full.countdown;
        if (!cd || !cd.id || cd.id === lastCountdownId) return;
        var startedAt = Number(cd.started_at) || 0;
        if (!startedAt || (Date.now() / 1000 - startedAt) > 45) {
            lastCountdownId = cd.id;
            return;
        }
        startCountdownFromSignal(countdownConfig.duration, countdownConfig.speed, cd.id);
    }

    function triggerCountdownStart() {
        if (isCountingDown || lastSessionStatus === 'active') return;
        isCountingDown = true;
        // El servidor propaga el aviso a todos los dispositivos; cada uno cuenta
        // desde su propio reloj al recibirlo (no depende del reloj del servidor).
        postJson('/api/race/start-countdown').then(function (res) {
            var cfg = res || {};
            if (cfg.id) lastCountdownId = cfg.id;
            return runCountdown(
                cfg.duration || countdownConfig.duration,
                cfg.speed || countdownConfig.speed
            );
        }).then(function () {
            isCountingDown = false;
            return postJson('/api/race/start');
        }).then(function (res) {
            if (res && res.success === false) {
                console.warn('[PISTA] No se pudo iniciar la carrera:', res.error);
            }
            loadData();
        });
    }

    // -------------------- SPLASH FIN DE CARRERA --------------------
    // Muestra el aviso "Carrera Finalizada ¡PARE!" una única vez, justo en el
    // instante en que la sesión pasa a 'completed'. Al ocultarse da paso al
    // podio. Es un overlay (no una vista del carrusel), por lo que nunca se
    // repite en la rotación automática.
    function showFinishSplash() {
        var overlay = document.getElementById('pistaFinishOverlay');
        if (!overlay || isFinishing) return;
        isFinishing = true;

        var content = overlay.querySelector('.pista-finish-content');
        if (content) {
            // Reinicia la animación de entrada en cada aparición.
            content.style.animation = 'none';
            void content.offsetWidth; // fuerza reflow
            content.style.animation = '';
        }
        overlay.style.display = 'flex';

        playBeep(660, 0.25, 0.6);
        setTimeout(function () { playBeep(660, 0.25, 0.6); }, 300);
        setTimeout(function () { playBeep(520, 0.5, 0.7); }, 600);

        clearTimeout(finishTimer);
        finishTimer = setTimeout(function () {
            overlay.style.display = 'none';
            isFinishing = false;
            // Tras el aviso, mostrar el podio de la carrera finalizada.
            setView('podio', true);
        }, FINISH_SPLASH_MS);
    }

    // --------------------- PANTALLA COMPLETA ---------------------
    function toggleFullscreen() {
        var doc = document.documentElement;
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            var req = doc.requestFullscreen || doc.webkitRequestFullscreen;
            if (req) req.call(doc);
        } else {
            var exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (exit) exit.call(document);
        }
    }

    // ------------------------- TIEMPO REAL -------------------------
    function setupRealtime() {
        if (typeof io === 'undefined') {
            console.warn('[PISTA] Socket.IO no disponible: se usa polling 500 ms');
            startPolling(POLL_MS);
            return;
        }
        try {
            socket = io({ transports: ['websocket', 'polling'] });

            socket.on('connect', function () {
                // Con tiempo real activo, el polling solo es red de seguridad.
                startPolling(SAFETY_POLL_MS);
            });

            socket.on('disconnect', function () {
                startPolling(POLL_MS);
            });

            socket.on('dashboard_update', function (payload) {
                renderFromPayload(payload);
            });

            socket.on('countdown_config', function (cfg) {
                if (!cfg) return;
                countdownConfig.duration = cfg.duration || 10;
                countdownConfig.speed = cfg.speed || 1.0;
            });

            socket.on('countdown_start', function (cfg) {
                var c = cfg || {};
                startCountdownFromSignal(c.duration, c.speed, c.id);
            });
        } catch (e) {
            console.warn('[PISTA] No se pudo iniciar el WebSocket:', e);
            startPolling(POLL_MS);
        }
    }

    // ------------------------- CONTROLES -------------------------
    function setupControls() {
        document.querySelectorAll('.pista-ctl-btn[data-view]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                setView(btn.getAttribute('data-view'), true);
            });
        });

        var startBtn = document.getElementById('pistaStartBtn');
        if (startBtn) startBtn.addEventListener('click', triggerCountdownStart);

        var fsBtn = document.getElementById('pistaFullscreenBtn');
        if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);

        document.addEventListener('keydown', function (ev) {
            var tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea') return;
            var k = (ev.key || '').toLowerCase();
            if (k === 't') setView('tabla', true);
            else if (k === 'p') setView('podio', true);
            else if (k === 'g') setView('grupos', true);
            else if (k === 's') triggerCountdownStart();
            else if (k === 'f') toggleFullscreen();
        });
    }

    function loadCountdownConfig() {
        return fetchJson('/api/countdown/config').then(function (res) {
            if (res && res.success !== false && res.duration) {
                countdownConfig.duration = res.duration;
                countdownConfig.speed = res.speed || 1.0;
            }
        });
    }

    // --------------------------- ARRANQUE ---------------------------
    setupControls();
    setView('tabla');
    loadLedColumnsConfig();
    loadCountdownConfig();
    setInterval(renderClock, 100);
    loadData();
    loadPodiumData();
    setInterval(loadPodiumData, PODIUM_POLL_MS);
    // Rotación automática respetando el intervalo configurado (AUTO_ROTATE_MS).
    var lastRotate = Date.now();
    setInterval(function () {
        if (Date.now() - lastRotate >= AUTO_ROTATE_MS) {
            lastRotate = Date.now();
            rotateView();
        }
    }, 1000);
    setupRealtime();
    startPolling(POLL_MS);
})();
