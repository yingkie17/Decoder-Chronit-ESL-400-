let isSimulationMode = false;
let simulationInterval = null;
let pendingAction = null;
let tvLapDetailsCache = [];
let tvRotationIndex = 0;
let raceTimerState = { seconds: 0, status: 'pending', lastSyncMs: Date.now() };
let frozenRaceData = null;
let lastRaceDataSnapshot = null;
let autoFinishInProgress = false;
let allTranspondersCache = [];
let editingTransponderId = null;
let sessionToken = null;
let currentRaceMode = 'position';
let currentTimeLimitSeconds = 0;
let isDeveloperMode = false;
let currentUserRole = null;

// ========== NUEVO: CACHÉ PARA OPTIMIZACIÓN ==========
let speedCache = {};           // Cache de velocidades
let lapDetailsCache = {};      // Cache de detalles de vueltas
let CACHE_DURATION = 5000;     // 5 segundos de validez
let lastRefreshTime = 0;
let pendingRefresh = false;

// ==================== NAVEGACIÓN DE PANELES ====================
function setupNavigation() {
    // Seleccionar todos los enlaces de navegación (tanto de escritorio como móvil)
    const allNavLinks = document.querySelectorAll('.nav-links a, .nav-links-mobile a');

    allNavLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const panelName = this.getAttribute('data-panel');

            // Limpiar clase active de todos los links
            document.querySelectorAll('.nav-links a, .nav-links-mobile a').forEach(a => a.classList.remove('active'));
            this.classList.add('active');

            // Ocultar todos los paneles
            document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'));

            // Mostrar el panel seleccionado
            const targetPanel = document.getElementById(`panel-${panelName}`);
            if (targetPanel) {
                targetPanel.classList.add('active');
            }

            // Cerrar menú móvil después de hacer clic (en móvil)
            const mobileMenu = document.getElementById('mobileMenu');
            if (mobileMenu && window.innerWidth <= 768) {
                mobileMenu.style.display = 'none';
            }
        });
    });
}

// Llamar a la función al cargar la página
setupNavigation();

// ========== MENÚ HAMBURGUESA ==========
const menuToggle = document.getElementById('menuToggle');
const mobileMenu = document.getElementById('mobileMenu');
const closeMenu = document.getElementById('closeMenu');

function openMobileMenu() {
    mobileMenu.classList.add('show');
}

function closeMobileMenu() {
    mobileMenu.classList.remove('show');
}

if (menuToggle) menuToggle.onclick = openMobileMenu;
if (closeMenu) closeMenu.onclick = closeMobileMenu;

// Cerrar menú al hacer clic en un enlace del menú móvil
document.querySelectorAll('#mobileMenu .nav-links-mobile a').forEach(link => {
    link.addEventListener('click', () => {
        closeMobileMenu();
    });
});

// Cerrar menú al hacer clic fuera del contenido
document.addEventListener('click', function (event) {
    if (mobileMenu && mobileMenu.classList.contains('show')) {
        if (!mobileMenu.contains(event.target) && event.target !== menuToggle) {
            closeMobileMenu();
        }
    }
});

// Cerrar menú al hacer clic fuera del contenido
document.addEventListener('click', function (event) {
    const mobileMenu = document.getElementById('mobileMenu');
    const menuToggle = document.getElementById('menuToggle');

    if (mobileMenu && mobileMenu.style.display === 'flex') {
        if (!mobileMenu.contains(event.target) && event.target !== menuToggle) {
            mobileMenu.style.display = 'none';
        }
    }
});
// ========== CERRAR MENÚ MÓVIL AL HACER CLIC ==========
function closeMobileMenuOnClick() {
    const mobileMenu = document.getElementById('mobileMenu');
    const menuToggle = document.getElementById('menuToggle');

    if (!mobileMenu) return;

    // Cerrar al hacer clic en un enlace del menú móvil
    document.querySelectorAll('#mobileMenu .nav-links-mobile a').forEach(link => {
        link.addEventListener('click', () => {
            mobileMenu.style.display = 'none';
        });
    });
}

// Llamar a esta función después de setupNavigation
closeMobileMenuOnClick();

function formatIndividualTime(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds)) {
        return "--";
    }

    const totalSeconds = Math.abs(Number(seconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const millis = Math.round((secs - Math.floor(secs)) * 1000);

    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${Math.floor(secs).toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
    } else {
        return `${minutes.toString().padStart(2, '0')}:${Math.floor(secs).toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
    }
}
function formatSpeed(speedKmh) {
    if (!speedKmh || speedKmh <= 0) return '--';
    return `${Math.round(speedKmh)} km/h`;
}

function showLoader(message) {
    document.getElementById('loaderMessage').innerText = message || 'Procesando...';
    document.getElementById('loaderOverlay').style.display = 'flex';
}

function hideLoader() {
    document.getElementById('loaderOverlay').style.display = 'none';
}

async function apiCall(url, options = {}) {
    try {
        const headers = { 'Content-Type': 'application/json' };

        // Agregar token de sesión si existe
        const token = sessionToken || localStorage.getItem('chronit_session_token');
        if (token) {
            headers['X-Session-Token'] = token;
        }

        const res = await fetch(url, {
            headers: headers,
            ...options
        });

        if (!res.ok) {
            console.warn(`API call failed: ${url} -> ${res.status}`);
            if (res.status === 401) {
                // Token inválido o expirado
                showToast('⚠️', 'Sesión expirada. Por favor inicia sesión nuevamente.', 'warning');
                localStorage.removeItem('chronit_session_token');
                localStorage.removeItem('chronit_user');
                isAuthenticated = false;
                currentUser = null;
                updateAuthUI();
            }
            return null;
        }
        return await res.json();
    } catch (e) {
        console.error("API Error:", e);
        return null;
    }
}

function formatRaceClock(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds)) {
        return "00:00.000";
    }

    const safe = Math.max(0, Number(totalSeconds) || 0);
    const totalMillis = Math.round(safe * 1000);
    const millis = totalMillis % 1000;
    const totalSecondsInt = Math.floor(totalMillis / 1000);
    const seconds = totalSecondsInt % 60;
    const minutes = Math.floor((totalSecondsInt % 3600) / 60);
    const hours = Math.floor(totalSecondsInt / 3600);
    const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${formatted}`;
    }
    return formatted;
}

// Función auxiliar para color según tiempo
function getTimeColorClass(seconds) {
    if (!seconds) return '';
    if (seconds < 60) return 'time-fast';
    if (seconds < 90) return 'time-medium';
    return 'time-slow';
}

function normalizeRaceMode(value) {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'time_attack' || v === 'time-attack' || v === 'timeattack' || v === 'ta') return 'time_attack';
    return 'position';
}

function raceModeLabel(mode) {
    return normalizeRaceMode(mode) === 'time_attack' ? 'Time Attack' : 'Position Race';
}

function raceModeDescription(mode) {
    return normalizeRaceMode(mode) === 'time_attack'
        ? 'Carrera por Tiempo Total: Gana quien complete las vueltas en el menor tiempo acumulado.'
        : 'Carrera por Posición: Gana quien complete todas las vueltas primero.';
}

function applyRaceTimerState(session) {
    raceTimerState = {
        seconds: Number(session?.race_elapsed_seconds || 0),
        status: session?.status || 'pending',
        lastSyncMs: Date.now()
    };
    renderRaceClock();
}

function renderRaceClock() {
    let seconds = raceTimerState.seconds;
    if (raceTimerState.status === 'active') {
        seconds += (Date.now() - raceTimerState.lastSyncMs) / 1000;
    }
    const label = formatRaceClock(seconds);
    ['liveRaceClock', 'publicRaceClock', 'tvRaceClock'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerText = label;
    });
}

function updateRaceControls(session) {
    const status = session?.status || 'pending';
    const btnStart = document.getElementById('startRaceBtn');
    const btnPause = document.getElementById('pauseRaceBtn');
    const btnResume = document.getElementById('resumeRaceBtn');
    const btnFinish = document.getElementById('finishRaceBtn');
    const btnRepeat = document.getElementById('repeatRaceBtn');
    const btnResetBoard = document.getElementById('resetBoardBtn');

    if (!(btnStart && btnPause && btnResume && btnFinish && btnRepeat && btnResetBoard)) return;

    if (status === 'active') {
        btnStart.style.display = 'none';
        btnPause.style.display = 'inline-block';
        btnResume.style.display = 'none';
        btnFinish.style.display = 'inline-block';
        btnRepeat.style.display = 'none';
        btnResetBoard.style.display = 'none';
        btnRepeat.disabled = true;
        btnResetBoard.disabled = true;
    } else if (status === 'paused') {
        btnStart.style.display = 'none';
        btnPause.style.display = 'none';
        btnResume.style.display = 'inline-block';
        btnFinish.style.display = 'inline-block';
        btnRepeat.style.display = 'none';
        btnResetBoard.style.display = 'none';
        btnRepeat.disabled = true;
        btnResetBoard.disabled = true;
    } else if (status === 'completed') {
        btnStart.style.display = 'none';
        btnPause.style.display = 'none';
        btnResume.style.display = 'none';
        btnFinish.style.display = 'none';
        btnRepeat.style.display = 'inline-block';
        btnResetBoard.style.display = 'inline-block';
        const showWinnerBtn = document.getElementById('showWinnerBtn');
        if (showWinnerBtn) showWinnerBtn.style.display = 'inline-block';
        btnRepeat.disabled = false;
        btnResetBoard.disabled = false;
    } else {
        btnStart.style.display = 'inline-block';
        btnPause.style.display = 'none';
        btnResume.style.display = 'none';
        btnFinish.style.display = 'none';
        btnRepeat.style.display = 'none';
        btnResetBoard.style.display = 'none';
        btnRepeat.disabled = true;
        btnResetBoard.disabled = true;
    }
}

function buildRaceSnapshot(data, forcedStatus = null) {
    if (!data || !data.session || !Array.isArray(data.leaderboard)) return null;
    return {
        ...data,
        active: true,
        session: { ...data.session, status: forcedStatus || data.session.status || 'pending' },
        leaderboard: [...data.leaderboard]
    };
}

function isCompletedByLaps(snapshot) {
    if (!snapshot || !snapshot.session || !Array.isArray(snapshot.leaderboard) || !snapshot.leaderboard.length) return false;
    const lapsLimit = Number(snapshot.session.laps_limit || 0);
    if (lapsLimit <= 0) return false;
    const finishedDrivers = snapshot.leaderboard.filter((d) => Number(d.total_laps || 0) >= lapsLimit).length;
    return finishedDrivers === snapshot.leaderboard.length;
}

async function loadTransponderHealth() {
    const tbody = document.getElementById('transponderHealthBody');
    if (!tbody) return;
    const data = await apiCall('/api/transponders/health');
    if (!Array.isArray(data) || !data.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:1rem;">Sin transponders registrados</td></tr>';
        return;
    }

    tbody.innerHTML = data.map((t) => {
        const transponderPercent = Math.min(100, (t.transponder_usage / 70) * 100).toFixed(1);

        // Colores
        let transponderColor = t.transponder_health === 'optimo' ? '#63d297' : (t.transponder_health === 'moderado' ? '#f4c06b' : '#ef7a86');
        let decoderColor = t.decoder_alert === '✅ OK' ? '#63d297' : (t.decoder_alert === '⚠️ Memoria media' ? '#f4c06b' : '#ef7a86');
        let intensityColor = t.intensity_alert === '🟢 NORMAL' ? '#63d297' : (t.intensity_alert === '🟡 MODERADA' ? '#f4c06b' : '#ef7a86');

        // Badges de estado
        const transponderBadge = `<span style="display: inline-block; background: ${transponderColor}20; color: ${transponderColor}; padding: 2px 6px; border-radius: 12px; font-size: 0.65rem;">🏷️ ${t.transponder_health}</span>`;
        const decoderBadge = `<span style="display: inline-block; background: ${decoderColor}20; color: ${decoderColor}; padding: 2px 6px; border-radius: 12px; font-size: 0.65rem;">🖥️ ${t.decoder_alert === '✅ OK' ? 'OK' : t.decoder_alert}</span>`;
        const intensityBadge = `<span style="display: inline-block; background: ${intensityColor}20; color: ${intensityColor}; padding: 2px 6px; border-radius: 12px; font-size: 0.65rem;">⏱️ ${t.intensity_alert}</span>`;

        return `
            <tr style="border-bottom: 1px solid #2a3240;">
                <td style="font-weight: bold;">${t.id}</td>
                <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis;">${t.assigned_driver || 'Sin asignar'}</td>
                <td>
                    <strong style="color: ${transponderColor};">${t.transponder_usage}</strong> vtas<br>
                    ${transponderBadge}
                </td>
                <td>
                    <strong style="color: ${decoderColor};">${t.decoder_memory}</strong> vtas<br>
                    ${decoderBadge}
                </td>
                <td>
                    <strong style="color: ${intensityColor};">${t.intensity}</strong> vtas<br>
                    ${intensityBadge}
                </td>
                <td>${t.last_seen ? t.last_seen.split('T')[1].split('.')[0] : '--'}</td>
                <td><button class="btn btn-sm" onclick="resetTransponderHealth(${t.id})">Reset</button></td>
            </tr>
            <tr style="border-bottom: 2px solid #2a3240;">
                <td colspan="7" style="padding: 4px 8px;">
                    <div style="height: 3px; background: #2a3240; width: 100%; border-radius: 2px;">
                        <div style="width: ${transponderPercent}%; background: ${transponderColor}; height: 100%; border-radius: 2px;"></div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}
// --- CONFIGURACIÓN DE ANTENA ---
async function loadAntennaConfig() {
    const res = await apiCall('/api/config/antenna');
    if (res) {
        document.getElementById('minSignalSlider').value = res.min_signal || 15;
        document.getElementById('minSignalValue').value = res.min_signal || 15;
        document.getElementById('filterTimeSlider').value = res.filter_time || 0.5;
        document.getElementById('filterTimeValue').value = res.filter_time || 0.5;
    }
}

// Sincronizar slider y input
if (document.getElementById('minSignalSlider')) {
    document.getElementById('minSignalSlider').oninput = function () {
        document.getElementById('minSignalValue').value = this.value;
    };
    document.getElementById('minSignalValue').onchange = function () {
        document.getElementById('minSignalSlider').value = this.value;
    };
    document.getElementById('filterTimeSlider').oninput = function () {
        document.getElementById('filterTimeValue').value = this.value;
    };
    document.getElementById('filterTimeValue').onchange = function () {
        document.getElementById('filterTimeSlider').value = this.value;
    };
}

// Guardar configuración
if (document.getElementById('saveAntennaConfigBtn')) {
    document.getElementById('saveAntennaConfigBtn').onclick = async () => {
        const config = {
            min_signal: parseInt(document.getElementById('minSignalSlider').value),
            filter_time: parseFloat(document.getElementById('filterTimeSlider').value)
        };

        const statusSpan = document.getElementById('antennaConfigStatus');
        statusSpan.innerText = '⏳ Guardando...';
        statusSpan.style.color = '#ffaa00';

        const res = await apiCall('/api/config/antenna', {
            method: 'POST',
            body: JSON.stringify(config)
        });

        if (res?.success) {

            statusSpan.innerText = '✅ Guardado';
            statusSpan.style.color = '#00c853';
            setTimeout(() => {
                statusSpan.innerText = '';
            }, 3000);
            showToast('Configuración guardada', 'Los cambios se han guardado correctamente.', 'success');
        } else {
            statusSpan.innerText = '❌ Error';
            statusSpan.style.color = '#e5484d';
        }
    };
}

// Botón Refrescar Transponders
if (document.getElementById('refreshTranspondersBtn')) {
    document.getElementById('refreshTranspondersBtn').onclick = () => {
        loadTransponders();
    };
}

function showModal(title, message, onConfirm) {
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalMessage').innerText = message;
    document.getElementById('modal').style.display = 'flex';
    pendingAction = onConfirm;
}

document.getElementById('modalCancel').onclick = () => {
    document.getElementById('modal').style.display = 'none';
    pendingAction = null;
};
document.getElementById('modalConfirm').onclick = () => {
    if (pendingAction) pendingAction();
    document.getElementById('modal').style.display = 'none';
    pendingAction = null;
};

// Navegación
document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const panelId = link.dataset.panel;
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`panel-${panelId}`).classList.add('active');
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        link.classList.add('active');
       if (panelId === 'drivers') {
                    console.log("🟢 Forzando recarga de pilotos...");
                    // Limpiar tablas primero
                    const driversTable = document.getElementById('driversList');
                    const raceTable = document.getElementById('raceDriversList');
                    if (driversTable) driversTable.innerHTML = '<tr><td colspan="4" style="text-align:center;">Cargando...</td></tr>';
                    if (raceTable) raceTable.innerHTML = '<tr><td colspan="3" style="text-align:center;">Cargando...</td></tr>';
                    // Ejecutar carga
                    loadDrivers();
                }
        if (panelId === 'transponders') loadTransponders();
        if (panelId === 'tableroPublico') loadTableroPublico();
        if (panelId === 'public') loadPublicView();
        if (panelId === 'tv') loadTvView();
        if (panelId === 'race-setup') {
            loadTimingConfig();
            loadTrackConfig();
        }
        if (panelId === 'system') {
            loadTransponderHealth();
            loadAntennaConfig();
            loadDbStats();
            loadBackupsList();
            loadTimingConfig();
            cargarIpConexion();
            loadPilotosBackupsList();
        }
    });
});



async function loadLiveData() {
    try {
        // ✅ UNA SOLA LLAMADA API para TODO
        const fullData = await apiCall('/api/dashboard/full-data');
            if (fullData && fullData.session && fullData.session.race_mode) {
                currentRaceMode = normalizeRaceMode(fullData.session.race_mode);
                console.log("🎯 Modo de carrera actualizado:", currentRaceMode);
            }
        
        if (!fullData || !fullData.active) {
            // ========== ESTADO: SIN CARRERA ACTIVA ==========
            applyRaceTimerState(null);
            updateRaceControls(null);
            
            const circuitNameEl = document.getElementById('circuitName');
            if (circuitNameEl) circuitNameEl.innerText = '--';
            
            const lapsLimitEl = document.getElementById('lapsLimit');
            if (lapsLimitEl) lapsLimitEl.innerText = '--';
            
            const totalDriversEl = document.getElementById('totalDrivers');
            if (totalDriversEl) totalDriversEl.innerText = '0';
            
            const finishedDriversEl = document.getElementById('finishedDrivers');
            if (finishedDriversEl) finishedDriversEl.innerText = '0';
            
            const leaderboardBodyEl = document.getElementById('leaderboardBody');
            if (leaderboardBodyEl) {
                leaderboardBodyEl.innerHTML = '<tr><td colspan="8" style="text-align:center;">Sin carrera activa</td></tr>';
            }
            
            const refreshTimeEl = document.getElementById('refreshTime');
            if (refreshTimeEl) {
                refreshTimeEl.innerHTML = new Date().toLocaleTimeString();
            }
            
            // Limpiar vistas públicas
            if (document.getElementById('liveLeaderboardPublicStyle')) {
                document.getElementById('liveLeaderboardPublicStyle').innerHTML = '<div style="text-align:center; padding:2rem;">Sin carrera activa</div>';
            }
            
            if (document.getElementById('liveLapsDetail')) {
                document.getElementById('liveLapsDetail').innerHTML = '<p class="muted-text" style="text-align:center;">Sin datos de vueltas</p>';
            }
            
            if (document.getElementById('liveTvLapsRotator')) {
                document.getElementById('liveTvLapsRotator').innerHTML = '<p class="muted-text">Esperando datos...</p>';
            }
            
            await loadTableroPublico(null);
            await loadPublicView(null);
            await loadTvView(null);
            
            // Monitor de USB y Señales (siempre se ejecuta)
            await loadUsbAndSignals();
            return;
        }
        
        // ========== HAY CARRERA ACTIVA ==========
        const session = fullData.session;
        const leaderboard = fullData.leaderboard;
        const lapDetails = fullData.lap_details;
        const speeds = fullData.speeds;
        const speedsMap = speeds || {};
        
        const status = session.status || 'pending';
        
        // Resetear flag de winner si la carrera no está completada
        if (status === 'active' || status === 'pending') {
            resetWinnerModalFlag();
        }
        
        // Ocultar loader si está visible
        if (status === 'completed') {
            const loaderOverlay = document.getElementById('loaderOverlay');
            if (loaderOverlay && loaderOverlay.style.display === 'flex') hideLoader();
        }
        
        // Aplicar estado del cronómetro
        applyRaceTimerState(session);
        updateRaceControls(session);
        updateLiveHeader(session);
        
        // ========== ACTUALIZAR ELEMENTOS BÁSICOS ==========
        const circuitNameEl = document.getElementById('circuitName');
        if (circuitNameEl) circuitNameEl.innerText = session.circuit_name || '--';
        
        const lapsLimitEl = document.getElementById('lapsLimit');
        if (lapsLimitEl) lapsLimitEl.innerText = session.laps_limit || '--';
        
        const totalDriversEl = document.getElementById('totalDrivers');
        if (totalDriversEl) totalDriversEl.innerText = leaderboard?.length || 0;
        
        const finishedDriversEl = document.getElementById('finishedDrivers');
        if (finishedDriversEl) finishedDriversEl.innerText = leaderboard?.filter(d => d.is_finished).length || 0;
        
        const raceNameLabel = document.getElementById('raceNameForEnrollment');
        if (raceNameLabel) raceNameLabel.innerText = session.circuit_name || '--';
        
        // ========== TIEMPOS INDIVIDUALES ==========
        const individualTimes = await apiCall(`/api/race/driver-times/${session.id}`);
        const timesMap = {};
        if (individualTimes && Array.isArray(individualTimes)) {
            individualTimes.forEach(t => {
                timesMap[t.driver_id] = t.individual_time_formatted || '--';
            });
        }
        
        // ========== RENDERIZAR LEADERBOARD PRINCIPAL ==========
        const tbody = document.getElementById('leaderboardBody');
        if (tbody) {
            if (leaderboard && leaderboard.length > 0) {
                tbody.innerHTML = leaderboard.map(d => {
                    const isWinner = d.position === 1 && (d.is_finished || status === 'completed');
                    const winnerTag = isWinner ? '<span class="winner-pill">Ganador</span>' : '';
                    const individualTime = timesMap[d.driver_id] || '--';
                    const bestLapFormatted = d.best_lap ? formatRaceClock(d.best_lap) : '--';
                    const lastLapFormatted = d.last_lap ? formatRaceClock(d.last_lap) : '--';
                    
                    return `<tr class="${isWinner ? 'winner-row' : ''}">
                        <td>${d.position}</td>
                        <td class="${isWinner ? 'winner-name' : ''}">${d.full_name || d.name}${winnerTag}</td>
                        <td>${d.transponder_id}</td>
                        <td>${d.total_laps || 0}</td>
                        <td class="best-lap">${bestLapFormatted}</td>
                        <td>${lastLapFormatted}</td>
                        <td class="best-lap">${individualTime}</td>
                        <td>${d.laps_remaining}</td>
                    </tr>`;
                }).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:1rem;">Sin pilotos en esta sesión</td></tr>';
            }
        }
        
        // ========== ACTUALIZAR TIMESTAMP ==========
        const refreshTimeEl = document.getElementById('refreshTime');
        if (refreshTimeEl) {
            refreshTimeEl.innerHTML = new Date().toLocaleTimeString();
        }
        
        // ========== PANEL LIVE ==========
        if (document.getElementById('liveLeaderboardPublicStyle')) {
            renderLiveLeaderboardPublicStyle(leaderboard, session, speedsMap, timesMap);
        }
        
        if (document.getElementById('liveLeaderName')) {
            const leader = leaderboard?.[0];
            document.getElementById('liveLeaderName').innerText = leader ? (leader.full_name || leader.name) : '--';
        }
        
        if (document.getElementById('liveLapsDetail')) {
            renderLapsDetailFromCache(lapDetails, leaderboard);
        }
        
        if (document.getElementById('liveTvLapsRotator')) {
            renderTvRotatorFromCache(lapDetails, leaderboard);
        }
        
        // ========== VISTAS PÚBLICAS ==========
        await loadTableroPublicoFromData(session, leaderboard, speeds);
        await loadPublicViewFromData(session, leaderboard, speeds);
        await loadTvViewFromData(session, leaderboard, speeds);
        
        // ========== VERIFICAR PODIO AUTOMÁTICO ==========
        if (status === 'completed' && !winnerModalShown) {
            const podiumRes = await apiCall('/api/session/current/podium');
            const podium = podiumRes?.podium || [];
            if (podium.length) {
                showWinnerModalComplete(podium[0], podium[1], podium[2]);
                winnerModalShown = true;
            }
        }
        
    } catch (error) {
        console.error("Error en loadLiveData:", error);
    }
    
    // Monitor de USB y Señales (siempre se ejecuta)
    await loadUsbAndSignals();
}

// ========== FUNCIÓN PARA USB Y SEÑALES (extraída para no repetir) ==========
async function loadUsbAndSignals() {
    try {
        const usb = await apiCall('/api/usb/status');
        const usbLed = document.getElementById('usbLed');
        if (usbLed) {
            if (usb?.connected) {
                usbLed.className = 'usb-led on';
                const usbTextEl = document.getElementById('usbText');
                if (usbTextEl) usbTextEl.innerText = `Conectado: ${usb.port}`;
            } else {
                usbLed.className = 'usb-led off';
                const usbTextEl = document.getElementById('usbText');
                if (usbTextEl) usbTextEl.innerText = 'Desconectado';
            }
        }
        
        const signals = await apiCall('/api/signals/recent?limit=20');
        const signalsBody = document.getElementById('signalsBody');
        if (signalsBody && signals) {
            signalsBody.innerHTML = signals.map(s => {
                const time = s.last_seen ? s.last_seen.split('T')[1].split('.')[0] : '--';
                const hl = (s.last_signal_h !== null && s.last_signal_l !== null) ? `${s.last_signal_h}/${s.last_signal_l}` : '--';
                return `<tr>
                    <td style="font-family:monospace; color:#e5484d; font-weight:bold;">${s.transponder_id}</td>
                    <td>${hl}</td>
                    <td>${s.last_time_accumulated || '--'}</td>
                    <td>${s.last_physical_laps || 0}</td>
                    <td style="font-size:0.7rem; color:#666;">${time}</td>
                </tr>`;
            }).join('');
        }
    } catch (e) {
        console.log("Error en monitor USB/señales:", e);
    }
}

//End of LOAD_LIVE_DATA()
//Funciones auxiliares de loadliveData
// ========== FUNCIONES AUXILIARES PARA RENDERIZADO RÁPIDO ==========

function renderLapsDetailFromCache(lapDetails, leaderboard) {
    const container = document.getElementById('liveLapsDetail');
    if (!container) return;
    
    if (!leaderboard || !leaderboard.length) {
        container.innerHTML = '<p class="muted-text" style="text-align:center;">Sin datos de vueltas</p>';
        return;
    }
    
    container.innerHTML = leaderboard.map(driver => {
        const laps = lapDetails[driver.driver_id] || [];
        if (!laps.length) {
            return `<div class="lap-box"><h4>${driver.full_name || driver.name}</h4><div style="padding:0.5rem;">Sin vueltas</div></div>`;
        }
        const rows = laps.slice(-6).reverse().map(l => `
            <tr>
                <td>V${l.lap_number}</td>
                <td>${formatRaceClock(l.lap_seconds)}</td>
                <td>${l.gap_to_leader ? `+${formatRaceClock(l.gap_to_leader)}` : '--'}</td>
                <td>${l.avg_speed_kmh ? Math.round(l.avg_speed_kmh) : '--'} km/h</td>
            </tr>
        `).join('');
        return `<div class="lap-box"><h4>${driver.full_name || driver.name}</h4><table class="compact-table"><thead><tr><th>Vuelta</th><th>Tiempo</th><th>Dif.Líder</th><th>Vel.</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
}

function renderTvRotatorFromCache(lapDetails, leaderboard) {
    const container = document.getElementById('liveTvLapsRotator');
    if (!container) return;
    
    if (!leaderboard || !leaderboard.length) {
        container.innerHTML = '<p class="muted-text">Esperando datos...</p>';
        return;
    }
    
    // Actualizar caché global del rotador
    if (cachedRotatorData.length === 0 || cachedRotatorData.length !== leaderboard.length) {
        cachedRotatorData = leaderboard.map(d => ({
            driver: d,
            laps: lapDetails[d.driver_id] || []
        }));
        currentRotatorIndex = 0;
    } else {
        // Actualizar solo los pilotos que cambiaron
        for (let i = 0; i < leaderboard.length; i++) {
            const driver = leaderboard[i];
            const cached = cachedRotatorData[i];
            const newLapsCount = lapDetails[driver.driver_id]?.length || 0;
            if (cached && cached.laps.length !== newLapsCount) {
                cachedRotatorData[i] = { driver: driver, laps: lapDetails[driver.driver_id] || [] };
            }
        }
    }
    
    // Mostrar piloto actual
    if (cachedRotatorData.length) {
        const current = cachedRotatorData[currentRotatorIndex % cachedRotatorData.length];
        const driverName = current.driver.full_name || current.driver.name;
        const recentLaps = current.laps.slice(-5).reverse();
        if (!recentLaps.length) {
            container.innerHTML = `<h4>${driverName}</h4><p>Sin vueltas registradas</p>`;
        } else {
            container.innerHTML = `<h4>${driverName} - Últimas vueltas</h4>
                <table class="compact-table"><thead><tr><th>Vuelta</th><th>Tiempo</th><th>Vel.</th></tr></thead><tbody>
                ${recentLaps.map(l => `<tr>
                    <td>V${l.lap_number}</td>
                    <td>${formatRaceClock(l.lap_seconds)}</td>
                    <td>${l.avg_speed_kmh ? Math.round(l.avg_speed_kmh) : '--'} km/h</td>
                </tr>`).join('')}
                </tbody></table>`;
        }
    }
}

// ========== VERSIONES OPTIMIZADAS DE VISTAS PÚBLICAS ==========

async function loadTableroPublicoFromData(session, leaderboard, speedsMap = {}) {
    const listaPilotos = document.getElementById('lista-pilotos');
    const raceTimer = document.getElementById('total_time');
    
    if (!listaPilotos) return;
    
    const driverColors = [
        '#ff9800', '#03a9f4', '#9c27b0', '#00bcd4', '#4caf50',
        '#ffeb3b', '#2196f3', '#ff5722', '#673ab7', '#e91e63',
        '#00e5ff', '#76ff03', '#ffc400', '#ff7043', '#ab47bc',
        '#00acc1', '#c0ca33', '#ec407a', '#42a5f5', '#26a69a',
    ];
    
    if (!session || !leaderboard || !leaderboard.length) {
        listaPilotos.innerHTML = '';
        if (raceTimer) raceTimer.innerText = '00:00';
        const raceNameDisplay = document.getElementById('publicRaceNameDisplay');
        const raceModeDisplay = document.getElementById('publicRaceModeDisplay');
        const raceDescDisplay = document.getElementById('publicRaceDescriptionDisplay');
        const statusBadge = document.getElementById('raceStatusBadge');
        if (raceNameDisplay) raceNameDisplay.innerText = '--';
        if (raceModeDisplay) raceModeDisplay.innerText = '--';
        if (raceDescDisplay) raceDescDisplay.innerText = '--';
        if (statusBadge) {
            statusBadge.innerText = '⏳ PENDIENTE';
            statusBadge.classList.remove('status-active', 'status-paused', 'status-completed');
            statusBadge.classList.add('status-pending');
        }
        return;
    }
    
    // Actualizar encabezados
    const raceNameDisplay = document.getElementById('publicRaceNameDisplay');
    if (raceNameDisplay) raceNameDisplay.innerText = session.circuit_name || 'Sin carrera';
    
    const raceModeDisplay = document.getElementById('publicRaceModeDisplay');
    if (raceModeDisplay) raceModeDisplay.innerText = `Modo: ${raceModeLabel(session.race_mode)}`;
    
    const raceDescDisplay = document.getElementById('publicRaceDescriptionDisplay');
    if (raceDescDisplay) raceDescDisplay.innerText = raceModeDescription(session.race_mode);
    
    const statusBadge = document.getElementById('raceStatusBadge');
    if (statusBadge) {
        const status = session.status || 'pending';
        statusBadge.classList.remove('status-pending', 'status-active', 'status-paused', 'status-completed');
        switch (status) {
            case 'active': statusBadge.innerText = '🏁 EN CURSO'; statusBadge.classList.add('status-active'); break;
            case 'paused': statusBadge.innerText = '⏸️ PAUSADA'; statusBadge.classList.add('status-paused'); break;
            case 'completed': statusBadge.innerText = '🏆 FINALIZADA'; statusBadge.classList.add('status-completed'); break;
            default: statusBadge.innerText = '⏳ PENDIENTE'; statusBadge.classList.add('status-pending');
        }
    }
    
    // Obtener tiempos individuales
    const individualTimes = await apiCall(`/api/race/driver-times/${session.id}`);
    const timesMap = {};
    if (individualTimes && Array.isArray(individualTimes)) {
        individualTimes.forEach(t => { timesMap[t.driver_id] = t.individual_time_formatted || '--'; });
    }
    
    // Cronómetro
    const finishedDrivers = leaderboard.filter(d => d.is_finished && d.total_time > 0);
    const allFinished = leaderboard.length > 0 && finishedDrivers.length === leaderboard.length;
    const finalDriverTime = finishedDrivers.length ? Math.max(...finishedDrivers.map(d => Number(d.total_time) || 0)) : 0;
    
    if (raceTimer) {
        if (allFinished && finalDriverTime > 0) {
            raceTimer.innerText = formatRaceClock(finalDriverTime);
        } else {
            let seconds = session.race_elapsed_seconds || 0;
            if (session.status === 'active') {
                seconds += (Date.now() - raceTimerState.lastSyncMs) / 1000;
            }
            raceTimer.innerText = formatRaceClock(seconds);
        }
    }
    
    // Orden de finalización para copas
    const finishedOrder = leaderboard
        .filter(d => d.is_finished && d.total_laps >= (session.laps_limit || 0))
        .sort((a, b) => (a.total_time || 0) - (b.total_time || 0));
    
    // Renderizar filas
    listaPilotos.innerHTML = leaderboard.map((driver, idx) => {
        const color = driverColors[idx % driverColors.length];
        const best = driver.best_lap != null ? formatRaceClock(driver.best_lap) : '--';
        const totalTime = driver.total_time != null ? formatRaceClock(driver.total_time) : '--';
        const individualTime = timesMap[driver.driver_id] || '--';
        const rowClass = idx === 0 ? 'row-first' : '';
        const progressLineClass = idx === 0 ? 'line-gold' : 'line-blue';
        const kartIdValue = typeof driver.kart_id === 'string' ? driver.kart_id.trim() : driver.kart_id;
        const kartLabel = kartIdValue ? kartIdValue : driver.transponder_id || '--';
        
        let cupIcon = '';
        if (driver.is_finished && driver.total_laps >= (session.laps_limit || 0)) {
            const posInFinished = finishedOrder.findIndex(d => d.driver_id === driver.driver_id);
            if (posInFinished === 0) cupIcon = ' 🏆';
            else if (posInFinished === 1) cupIcon = ' 🥈';
            else if (posInFinished === 2) cupIcon = ' 🥉';
        }
        
        return `
            <div class="k-row ${rowClass}">
                <div class="k-col-pos">${driver.position || (idx + 1)}</div>
                <div class="k-col-name">
                    <span class="driver-name">${driver.full_name || driver.name}${cupIcon} </span>
                    <div class="progress-line ${progressLineClass}" style="background: linear-gradient(90deg, ${color}, transparent);"></div>
                </div>
                <div class="k-col-vueltas">${driver.total_laps || 0}/${session.laps_limit || 0}</div>
                <div class="k-col-mejor"><span class="time-box box-gold">${best}</span></div>
                <div class="k-col-tiempo"><span class="time-box box-black">${totalTime}</span></div>
                <div class="k-col-tiempo-individual"><span class="time-box box-black">${individualTime}</span></div>
                <div class="k-col-kart"><span class="kart-circle" style="background-color: ${color};">${kartLabel}</span></div>
            </div>
        `;
    }).join('');
}

async function loadPublicViewFromData(session, leaderboard, speedsMap = {}) {
    const body = document.getElementById('publicLeaderboardBody');
    const lapsDetail = document.getElementById('publicLapsDetail');
    const publicRaceName = document.getElementById('publicRaceName');
    const publicLapsLimit = document.getElementById('publicLapsLimit');
    const publicRaceMode = document.getElementById('publicRaceMode');
    const publicRaceDescription = document.getElementById('publicRaceDescription');
    const publicRaceLabel = document.getElementById('publicRaceLabel');
    const publicRaceStatus = document.getElementById('publicRaceStatus');
    const publicDriversCount = document.getElementById('publicDriversCount');
    const publicLeaderName = document.getElementById('publicLeaderName');
    
    if (!body || !lapsDetail) return;
    
    if (!session || !leaderboard || !leaderboard.length) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;">Sin carrera activa</td></tr>';
        lapsDetail.innerHTML = '<p class="muted-text">No hay información de vueltas disponible.</p>';
        if (publicRaceName) publicRaceName.innerText = '--';
        if (publicLapsLimit) publicLapsLimit.innerText = '--';
        if (publicRaceMode) publicRaceMode.innerText = '--';
        if (publicRaceDescription) publicRaceDescription.innerText = '--';
        if (publicRaceLabel) publicRaceLabel.innerText = '--';
        if (publicRaceStatus) publicRaceStatus.innerText = '--';
        if (publicDriversCount) publicDriversCount.innerText = '0';
        if (publicLeaderName) publicLeaderName.innerText = '--';
        return;
    }
    
    // Actualizar encabezados
    if (publicRaceName) publicRaceName.innerText = session.circuit_name || '--';
    if (publicLapsLimit) publicLapsLimit.innerText = session.laps_limit || '--';
    if (publicRaceMode) publicRaceMode.innerText = raceModeLabel(session.race_mode);
    if (publicRaceDescription) publicRaceDescription.innerText = raceModeDescription(session.race_mode);
    if (publicRaceLabel) publicRaceLabel.innerText = session.circuit_name || '--';
    if (publicRaceStatus) publicRaceStatus.innerText = session.status || 'pending';
    if (publicDriversCount) publicDriversCount.innerText = String(leaderboard.length || 0);
    
    const leader = leaderboard[0];
    if (publicLeaderName) publicLeaderName.innerText = leader ? (leader.full_name || leader.name) : '--';
    
    // Obtener tiempos individuales
    const individualTimes = await apiCall(`/api/race/driver-times/${session.id}`);
    const timesMap = {};
    if (individualTimes && Array.isArray(individualTimes)) {
        individualTimes.forEach(t => { timesMap[t.driver_id] = t.individual_time_formatted || '--'; });
    }
    
    // Renderizar tabla
    body.innerHTML = leaderboard.map((d, idx) => {
        const total = d.total_time ? formatRaceClock(d.total_time) : '--';
        const best = d.best_lap ? formatRaceClock(d.best_lap) : '--';
        const last = d.last_lap ? formatRaceClock(d.last_lap) : '--';
        const speed = d.avg_speed_kmh ? `${Math.round(d.avg_speed_kmh)} km/h` : '--';
        const position = d.position || (idx + 1);
        const isWinner = d.position === 1 && (d.is_finished || session.status === 'completed');
        const winnerTag = isWinner ? '<span class="winner-pill">Ganador</span>' : '';
        
        return `<tr>
            <td style="font-weight: bold; font-size: 1.1rem; text-align: center;">${position}</td>
            <td class="${isWinner ? 'winner-name' : ''}">${d.full_name || d.name}${winnerTag}</td>
            <td>${d.total_laps || 0}</td>
            <td>${total}</td>
            <td class="best-lap">${best}</td>
            <td>${last}</td>
            <td>${speed}</td>
        </tr>`;
    }).join('');
    
    // Detalle de vueltas (simplificado)
    const allLapDetails = await Promise.all(
        leaderboard.slice(0, 5).map(async (d) => {
            const laps = await apiCall(`/api/race/lap-details/${session.id}/${d.driver_id}`);
            return { driver: d, laps: Array.isArray(laps) ? laps.slice(-5) : [] };
        })
    );
    
    const lapBlocks = allLapDetails.map(({ driver, laps }) => {
        if (!laps.length) {
            return `<div class="lap-box"><h4>${driver.full_name || driver.name}</h4><div style="padding:0.7rem;">Sin vueltas</div></div>`;
        }
        const rows = laps.map(l => {
            const lapTime = l.lap_seconds !== null ? formatRaceClock(l.lap_seconds) : '--';
            const gap = l.gap_to_leader !== null ? `+${formatRaceClock(l.gap_to_leader)}` : '--';
            return `<tr><td>V${l.lap_number}</td><td>${lapTime}</td><td>${gap}</tr>`;
        }).join('');
        return `<div class="lap-box"><h4>${driver.full_name || driver.name}</h4><table><thead><tr><th>Vuelta</th><th>Tiempo</th><th>Dif. líder</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
    
    lapsDetail.innerHTML = lapBlocks || '<p class="muted-text">Sin detalles de vueltas.</p>';
}

async function loadTvViewFromData(session, leaderboard, speedsMap = {}) {
    const body = document.getElementById('tvLeaderboardBody');
    const title = document.getElementById('tvRaceTitle');
    const status = document.getElementById('tvRaceStatus');
    const leaderName = document.getElementById('tvLeaderName');
    const leaderMeta = document.getElementById('tvLeaderMeta');
    const driversCount = document.getElementById('tvDriversCount');
    const lapsLimit = document.getElementById('tvLapsLimit');
    const refreshTime = document.getElementById('tvRefreshTime');
    const clock = document.getElementById('tvClock');
    
    if (clock) clock.innerText = new Date().toLocaleTimeString();
    if (!body) return;
    
    if (!session || !leaderboard || !leaderboard.length) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;">Sin carrera activa</td></tr>';
        if (title) title.innerText = 'Carrera en Espera';
        if (status) status.innerText = '--';
        if (leaderName) leaderName.innerText = '--';
        if (leaderMeta) leaderMeta.innerText = 'Líder actual';
        if (driversCount) driversCount.innerText = '0';
        if (lapsLimit) lapsLimit.innerText = '--';
        if (refreshTime) refreshTime.innerText = '--';
        return;
    }
    
    if (title) title.innerText = session.circuit_name || 'Carrera en Curso';
    if (status) status.innerText = session.status || 'pending';
    if (driversCount) driversCount.innerText = String(leaderboard.length || 0);
    if (lapsLimit) lapsLimit.innerText = String(session.laps_limit || '--');
    if (refreshTime) refreshTime.innerText = new Date().toLocaleTimeString();
    
    const leader = leaderboard[0];
    if (leader) {
        const leadBest = leader.best_lap ? Number(leader.best_lap).toFixed(3) : '--';
        if (leaderName) leaderName.innerText = leader.full_name || leader.name || '--';
        if (leaderMeta) leaderMeta.innerText = `Posición 1 | Mejor vuelta ${leadBest}`;
    }
    
    body.innerHTML = leaderboard.map((d, idx) => {
        const total = d.total_time ? formatRaceClock(d.total_time) : '--';
        const best = d.best_lap ? formatRaceClock(d.best_lap) : '--';
        const gapLeader = idx === 0 ? 'Líder' : formatGap((d.total_time || 0) - (leader?.total_time || 0));
        const isWinner = d.position === 1 && (d.is_finished || session.status === 'completed');
        const winnerTag = isWinner ? '<span class="winner-pill">Ganador</span>' : '';
        return `<tr>
            <td>${d.position || (idx + 1)}</td>
            <td class="${isWinner ? 'winner-name' : ''}">${d.full_name || d.name}${winnerTag}</td>
            <td>${d.total_laps || 0}</td>
            <td>${total}</td>
            <td class="best-lap">${best}</td>
            <td>${gapLeader}</td>
        </tr>`;
    }).join('');
    
    // Actualizar rotador de TV
    tvLapDetailsCache = await Promise.all(
        leaderboard.slice(0, 8).map(async (d) => {
            const laps = await apiCall(`/api/race/lap-details/${session.id}/${d.driver_id}`);
            return { driver: d, laps: Array.isArray(laps) ? laps.slice(-8) : [] };
        })
    );
    renderTvLapRotator();
}

//End Functions Auxiliares de LoadLiveData



async function loadPublicView(preloaded = null) {
    const data = preloaded || await apiCall('/api/session/current');
    const body = document.getElementById('publicLeaderboardBody');
    const lapsDetail = document.getElementById('publicLapsDetail');
    const publicRaceName = document.getElementById('publicRaceName');
    const publicLapsLimit = document.getElementById('publicLapsLimit');
    const publicRaceMode = document.getElementById('publicRaceMode');
    const publicRaceDescription = document.getElementById('publicRaceDescription');
    const publicRaceLabel = document.getElementById('publicRaceLabel');
    const publicRaceStatus = document.getElementById('publicRaceStatus');
    const publicDriversCount = document.getElementById('publicDriversCount');
    const publicLeaderName = document.getElementById('publicLeaderName');

    if (!body || !lapsDetail) return;

    // Caso: No hay carrera activa o sesión inválida
    if (!data || !data.active || !data.session) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;">Sin carrera activa</td></tr>';
        lapsDetail.innerHTML = '<p class="muted-text">No hay informacion de vueltas disponible.</p>';
        if (publicRaceName) publicRaceName.innerText = '--';
        if (publicLapsLimit) publicLapsLimit.innerText = '--';
        if (publicRaceMode) publicRaceMode.innerText = '--';
        if (publicRaceDescription) publicRaceDescription.innerText = '--';
        if (publicRaceLabel) publicRaceLabel.innerText = '--';
        if (publicRaceStatus) publicRaceStatus.innerText = '--';
        const publicRaceClock = document.getElementById('publicRaceClock');
        if (publicRaceClock) publicRaceClock.innerText = '00:00';
        if (publicDriversCount) publicDriversCount.innerText = '0';
        if (publicLeaderName) publicLeaderName.innerText = '--';
        return;
    }

    const session = data.session;
    const leaderboard = data.leaderboard || [];
    const leader = leaderboard[0];

    // Actualizar encabezados
    if (publicRaceName) publicRaceName.innerText = session.circuit_name || '--';
    if (publicLapsLimit) publicLapsLimit.innerText = session.laps_limit || '--';
    if (publicRaceMode) publicRaceMode.innerText = raceModeLabel(session.race_mode);
    if (publicRaceDescription) publicRaceDescription.innerText = raceModeDescription(session.race_mode);
    if (publicRaceLabel) publicRaceLabel.innerText = session.circuit_name || '--';
    if (publicRaceStatus) publicRaceStatus.innerText = session.status || 'pending';
    if (publicDriversCount) publicDriversCount.innerText = String(leaderboard.length || 0);
    if (publicLeaderName) publicLeaderName.innerText = leader ? (leader.full_name || leader.name) : '--';

    if (!leaderboard.length) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;">No hay pilotos inscritos</td></tr>';
        lapsDetail.innerHTML = '<p class="muted-text">Todavia no hay vueltas registradas.</p>';
        return;
    }

    // Obtener tiempos individuales formateados
    const individualTimes = await apiCall(`/api/race/driver-times/${session.id}`);
    const timesMap = {};
    if (individualTimes && Array.isArray(individualTimes)) {
        individualTimes.forEach(t => {
            timesMap[t.driver_id] = t.individual_time_formatted || '--';
        });
    }

    // --- RENDERIZADO DE LA TABLA PÚBLICA ---
    body.innerHTML = leaderboard.map((d, idx) => {
        const total = d.total_time ? formatRaceClock(d.total_time) : '--';
        const best = d.best_lap ? formatRaceClock(d.best_lap) : '--';
        const last = d.last_lap ? formatRaceClock(d.last_lap) : '--';
        const individualTime = timesMap[d.driver_id] || '--';
        const position = d.position || (idx + 1);
        const isWinner = d.position === 1 && (d.is_finished || session.status === 'completed');
        const winnerTag = isWinner ? '<span class="winner-pill">Ganador</span>' : '';

        return `<tr>
                <td style="font-weight: bold; font-size: 1.1rem; text-align: center;">${position}</td>
                <td class="${isWinner ? 'winner-name' : ''}">${d.full_name || d.name}${winnerTag}</td>
                <td>${d.total_laps || 0}</td>
                <td>${total}</td>
                <td class="best-lap">${best}</td>
                <td>${formatSpeed(speedsMap[d.driver_id])}</td>
                <td>${last}</td>
            </tr>`;
    }).join('');

    // --- DETALLE DE VUELTAS ---
    const allLapDetails = await Promise.all(
        leaderboard.map(async (d) => {
            const laps = await apiCall(`/api/race/lap-details/${session.id}/${d.driver_id}`);
            return { driver: d, laps: Array.isArray(laps) ? laps : [] };
        })
    );

    const lapBlocks = allLapDetails.map(({ driver, laps }) => {
        if (!laps.length) {
            return `<div class="lap-box">
                <h4>${driver.full_name || driver.name}</h4>
                <div style="padding:0.7rem; font-size:0.72rem; color:#a4adbc;">Sin vueltas registradas aun.</div>
            </div>`;
        }

        const rows = laps.map(l => {
            const lapTime = l.lap_seconds !== null ? formatRaceClock(l.lap_seconds) : '--';
            const gap = l.gap_to_leader !== null ? `+${formatRaceClock(l.gap_to_leader)}` : '--';
            return `<tr>
                <td>V${l.lap_number}</td>
                <td>${lapTime}</td>
                <td>${gap}</td>
            </tr>`;
        }).join('');

        return `<div class="lap-box">
            <h4>${driver.full_name || driver.name}</h4>
            <table>
                <thead><tr><th>Vuelta</th><th>Tiempo</th><th>Dif. lider</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    }).join('');

    lapsDetail.innerHTML = lapBlocks || '<p class="muted-text">Sin detalles de vueltas.</p>';
}


async function loadLiveLapsDetail(sessionId, leaderboard) {
    const container = document.getElementById('liveLapsDetail');
    if (!container || !sessionId || !leaderboard?.length) {
        if (container) container.innerHTML = '<p class="muted-text" style="text-align:center;">Sin datos de vueltas</p>';
        return;
    }

    const allLaps = await Promise.all(
        leaderboard.map(async (d) => {
            const laps = await apiCall(`/api/race/lap-details/${sessionId}/${d.driver_id}`);
            return { driver: d, laps: Array.isArray(laps) ? laps : [] };
        })
    );

    container.innerHTML = allLaps.map(({ driver, laps }) => {
        if (!laps.length) {
            return `<div class="lap-box"><h4>${driver.full_name || driver.name}</h4><div style="padding:0.5rem;">Sin vueltas</div></div>`;
        }
        const rows = laps.slice(-6).map(l => `
                    <tr>
                        <td>V${l.lap_number}</td>
                        <td>${formatRaceClock(l.lap_seconds)}</td>
                        <td>${l.gap_to_leader ? `+${formatRaceClock(l.gap_to_leader)}` : '--'}</td>
                        <td>${l.avg_speed_kmh ? Math.round(l.avg_speed_kmh) : '--'} km/h</td>
                    </tr>
                `).join('');
        return `<div class="lap-box"><h4>${driver.full_name || driver.name}</h4><table class="compact-table"><thead><tr><th>Vuelta</th><th>Tiempo</th><th>Dif.Líder</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
}


let tvRotatorInterval = null;
let currentRotatorIndex = 0;
let cachedRotatorData = [];
let lastSessionIdForRotator = null;
let lastLeaderboardHashForRotator = null;

function getLeaderboardHash(leaderboard) {
    if (!leaderboard || !leaderboard.length) return null;
    return leaderboard.map(d => d.driver_id).sort().join(',');
}

async function loadLiveTvRotator(sessionId, leaderboard) {
    const container = document.getElementById('liveTvLapsRotator');
    if (!container || !sessionId || !leaderboard?.length) {
        if (container) container.innerHTML = '<p class="muted-text">Esperando datos...</p>';
        if (tvRotatorInterval) {
            clearInterval(tvRotatorInterval);
            tvRotatorInterval = null;
        }
        return;
    }

    const currentHash = getLeaderboardHash(leaderboard);

    // Si no hay cambios en la sesión o en los pilotos, NO recargar
    if (lastSessionIdForRotator === sessionId && lastLeaderboardHashForRotator === currentHash && cachedRotatorData.length > 0) {
        // Solo actualizar los tiempos de vueltas si es necesario (sin recargar todo)
        for (let i = 0; i < cachedRotatorData.length; i++) {
            const driver = cachedRotatorData[i];
            const freshLaps = await apiCall(`/api/race/lap-details/${sessionId}/${driver.driver.driver_id}`);
            if (freshLaps && freshLaps.length !== driver.laps.length) {
                driver.laps = freshLaps;
            }
        }
        // Forzar actualización del piloto actual
        if (cachedRotatorData.length > 0) {
            const current = cachedRotatorData[currentRotatorIndex % cachedRotatorData.length];
            const driverName = current.driver.full_name || current.driver.name;
            const recentLaps = current.laps.slice(-5).reverse();
            if (!recentLaps.length) {
                container.innerHTML = `<h4>${driverName}</h4><p>Sin vueltas registradas</p>`;
            } else {
                container.innerHTML = `<h4>${driverName} - Últimas vueltas</h4>
                    <table class="compact-table"><thead><tr><th>Vuelta</th><th>Tiempo</th><th>Dif.Líder</th><th>Vel.</th></tr></thead>`;
            }
        }
        return;
    }

    // Primera vez o hay cambios: cargar datos completos
    lastSessionIdForRotator = sessionId;
    lastLeaderboardHashForRotator = currentHash;

    cachedRotatorData = await Promise.all(
        leaderboard.map(async (d) => {
            const laps = await apiCall(`/api/race/lap-details/${sessionId}/${d.driver_id}`);
            return { driver: d, laps: Array.isArray(laps) ? laps : [] };
        })
    );

    currentRotatorIndex = 0;

    if (tvRotatorInterval) {
        clearInterval(tvRotatorInterval);
        tvRotatorInterval = null;
    }

    function showCurrent() {
        if (!cachedRotatorData.length) return;
        const current = cachedRotatorData[currentRotatorIndex % cachedRotatorData.length];
        const driverName = current.driver.full_name || current.driver.name;
        const recentLaps = current.laps.slice(-5).reverse();

        if (!recentLaps.length) {
            container.innerHTML = `<h4>${driverName}</h4><p>Sin vueltas registradas</p>`;
        } else {
            container.innerHTML = `<h4>${driverName} - Últimas vueltas</h4>
                <table class="compact-table"><thead><tr><th>Vuelta</th><th>Tiempo</th><th>Vel.</th><tr></thead><tbody>
                ${recentLaps.map(l => `<tr>
                    <td>V${l.lap_number}</td>
                    <td>${formatRaceClock(l.lap_seconds)}</td>
                    <td>${l.avg_speed_kmh ? Math.round(l.avg_speed_kmh) : '--'} km/h</td>
                </tr>`).join('')}
                </tbody></table>`;
        }
    }

    showCurrent();

    tvRotatorInterval = setInterval(() => {
        currentRotatorIndex++;
        showCurrent();
    }, 5000);
}

function formatGap(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    const n = Number(value);
    if (n <= 0) return 'Lider';
    return `+${n.toFixed(3)} s`;
}

function renderTvLapRotator() {
    const box = document.getElementById('tvLapsRotator');
    if (!box) return;
    if (!tvLapDetailsCache.length) {
        box.innerHTML = '<p class="muted-text">Esperando datos de vueltas...</p>';
        return;
    }

    const current = tvLapDetailsCache[tvRotationIndex % tvLapDetailsCache.length];
    const driverName = current.driver.full_name || current.driver.name || 'Piloto';

    if (!current.laps.length) {
        box.innerHTML = `<h4>${driverName}</h4><p class="muted-text">Aun sin vueltas registradas.</p>`;
        return;
    }

    const recentLaps = current.laps.slice(-8).reverse();
    const rows = recentLaps.map((lap) => {
        const lapTime = lap.lap_seconds !== null ? Number(lap.lap_seconds).toFixed(3) : '--';
        const gap = formatGap(lap.gap_to_leader);
        return `<tr>
                    <td>V${lap.lap_number}</td>
                    <td>${lapTime}</td>
                    <td>${gap}</td>
                </tr>`;
    }).join('');

    box.innerHTML = `<h4>${driverName} - Ultimas Vueltas</h4>
                <table>
                    <thead><tr><th>Vuelta</th><th>Tiempo</th><th>Dif. Lider</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>`;
}

async function loadTvView(preloaded = null) {
    const data = preloaded || await apiCall('/api/session/current');
    let speedsMap = {};
    if (data && data.active && data.session && data.leaderboard) {
        for (const driver of data.leaderboard) {
            try {
                const lapsWithSpeed = await apiCall(`/api/laps/speed/${data.session.id}/${driver.driver_id}`);
                if (lapsWithSpeed && lapsWithSpeed.length > 0) {
                    const lastLap = lapsWithSpeed[lapsWithSpeed.length - 1];
                    if (lastLap.avg_speed_kmh && lastLap.avg_speed_kmh > 0 && lastLap.avg_speed_kmh < 400) {
                        speedsMap[driver.driver_id] = lastLap.avg_speed_kmh;
                    }
                }
            } catch (e) { console.warn("Error obteniendo velocidad en TvView:", e); }
        }
    }
    const body = document.getElementById('tvLeaderboardBody');
    const title = document.getElementById('tvRaceTitle');
    const status = document.getElementById('tvRaceStatus');
    const leaderName = document.getElementById('tvLeaderName');
    const leaderMeta = document.getElementById('tvLeaderMeta');
    const driversCount = document.getElementById('tvDriversCount');
    const lapsLimit = document.getElementById('tvLapsLimit');
    const refreshTime = document.getElementById('tvRefreshTime');
    const clock = document.getElementById('tvClock');

    if (clock) clock.innerText = new Date().toLocaleTimeString();
    if (!body) return;

    if (!data || !data.active || !data.session) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;">Sin carrera activa</td></tr>';
        if (title) title.innerText = 'Carrera en Espera';
        if (status) status.innerText = '--';
        const tvRaceClock = document.getElementById('tvRaceClock');
        if (tvRaceClock) tvRaceClock.innerText = '00:00';
        if (leaderName) leaderName.innerText = '--';
        if (leaderMeta) leaderMeta.innerText = 'Lider actual';
        if (driversCount) driversCount.innerText = '0';
        if (lapsLimit) lapsLimit.innerText = '--';
        if (refreshTime) refreshTime.innerText = '--';
        tvLapDetailsCache = [];
        tvRotationIndex = 0;
        renderTvLapRotator();
        return;
    }

    const session = data.session;
    const leaderboard = data.leaderboard || [];
    const leader = leaderboard[0];
    if (title) title.innerText = session.circuit_name || 'Carrera en Curso';
    if (status) status.innerText = session.status || 'pending';
    if (driversCount) driversCount.innerText = String(leaderboard.length || 0);
    if (lapsLimit) lapsLimit.innerText = String(session.laps_limit || '--');
    if (refreshTime) refreshTime.innerText = new Date().toLocaleTimeString();

    if (leader) {
        const leadBest = leader.best_lap ? Number(leader.best_lap).toFixed(3) : '--';
        leaderName.innerText = leader.full_name || leader.name || '--';
        leaderMeta.innerText = `Posicion 1 | Mejor vuelta ${leadBest}`;
    } else {
        leaderName.innerText = '--';
        leaderMeta.innerText = 'Lider actual';
    }

    body.innerHTML = leaderboard.length ? leaderboard.map((d, idx) => {
        const total = d.total_time ? formatRaceClock(d.total_time) : '--';
        const best = d.best_lap ? formatRaceClock(d.best_lap) : '--';
        const gapLeader = idx === 0 ? 'Lider' : formatGap((d.total_time || 0) - (leader?.total_time || 0));
        const isWinner = d.position === 1 && (d.is_finished || session.status === 'completed');
        const winnerTag = isWinner ? '<span class="winner-pill">Ganador</span>' : '';
        return `<tr>
                    <td>${d.position || (idx + 1)}</td>
                    <td class="${isWinner ? 'winner-name' : ''}">${d.full_name || d.name}${winnerTag}</td>
                    <td>${d.total_laps || 0}</td>
                    <td>${total}</td>
                   <td class="best-lap">${best}</td>
                    <td>${formatSpeed(speedsMap[d.driver_id])}</td>
                    <td>${gapLeader}</td>
                </tr>`;
    }).join('') : '<tr><td colspan="6" style="text-align:center;padding:2rem;">No hay pilotos inscritos</td></tr>';

    tvLapDetailsCache = await Promise.all(
        leaderboard.map(async (d) => {
            const laps = await apiCall(`/api/race/lap-details/${session.id}/${d.driver_id}`);
            return { driver: d, laps: Array.isArray(laps) ? laps : [] };
        })
    );
    renderTvLapRotator();
}



async function loadTableroPublico(preloaded = null) {
    const data = preloaded || await apiCall('/api/session/current');
    console.log("🔵 loadTableroPublico - datos recibidos:", data);

    const listaPilotos = document.getElementById('lista-pilotos');
    const raceTimer = document.getElementById('total_time');

    if (!listaPilotos) {
        console.error("❌ Error: elemento 'lista-pilotos' no encontrado en el DOM");
        return;
    }

    const driverColors = [
        '#ff9800', '#03a9f4', '#9c27b0', '#00bcd4', '#4caf50',
        '#ffeb3b', '#2196f3', '#ff5722', '#673ab7', '#e91e63',
        '#00e5ff', '#76ff03', '#ffc400', '#ff7043', '#ab47bc',
        '#00acc1', '#c0ca33', '#ec407a', '#42a5f5', '#26a69a',
    ];

    if (!data || !data.active || !data.session) {
        listaPilotos.innerHTML = '';
        if (raceTimer) raceTimer.innerText = '00:00';
        const raceNameDisplay = document.getElementById('publicRaceNameDisplay');
        const raceModeDisplay = document.getElementById('publicRaceModeDisplay');
        const raceDescDisplay = document.getElementById('publicRaceDescriptionDisplay');
        const statusBadge = document.getElementById('raceStatusBadge');
        if (raceNameDisplay) raceNameDisplay.innerText = '--';
        if (raceModeDisplay) raceModeDisplay.innerText = '--';
        if (raceDescDisplay) raceDescDisplay.innerText = '--';
        if (statusBadge) {
            statusBadge.innerText = '⏳ PENDIENTE';
            statusBadge.classList.remove('status-active', 'status-paused', 'status-completed');
            statusBadge.classList.add('status-pending');
        }
        return;
    }

    const session = data.session;
    const leaderboard = data.leaderboard || [];

    const raceNameDisplay = document.getElementById('publicRaceNameDisplay');
    if (raceNameDisplay) raceNameDisplay.innerText = session.circuit_name || 'Sin carrera';
    const raceModeDisplay = document.getElementById('publicRaceModeDisplay');
    if (raceModeDisplay) raceModeDisplay.innerText = `Modo: ${raceModeLabel(session.race_mode)}`;
    const raceDescDisplay = document.getElementById('publicRaceDescriptionDisplay');
    if (raceDescDisplay) raceDescDisplay.innerText = raceModeDescription(session.race_mode);

    const statusBadge = document.getElementById('raceStatusBadge');
    if (statusBadge) {
        const status = session.status || 'pending';
        statusBadge.classList.remove('status-pending', 'status-active', 'status-paused', 'status-completed');
        switch (status) {
            case 'active': statusBadge.innerText = '🏁 EN CURSO'; statusBadge.classList.add('status-active'); break;
            case 'paused': statusBadge.innerText = '⏸️ PAUSADA'; statusBadge.classList.add('status-paused'); break;
            case 'completed': statusBadge.innerText = '🏆 FINALIZADA'; statusBadge.classList.add('status-completed'); break;
            default: statusBadge.innerText = '⏳ PENDIENTE'; statusBadge.classList.add('status-pending');
        }
    }

    const individualTimes = await apiCall(`/api/race/driver-times/${session.id}`);
    const timesMap = {};
    if (individualTimes && Array.isArray(individualTimes)) {
        individualTimes.forEach(t => { timesMap[t.driver_id] = t.individual_time_formatted || '--'; });
    }

    // Obtener velocidades de manera segura
    let speedsMap = {};
    if (session && session.id && leaderboard.length > 0) {
        for (const driver of leaderboard) {
            try {
                const lapsWithSpeed = await apiCall(`/api/laps/speed/${session.id}/${driver.driver_id}`);
                if (lapsWithSpeed && lapsWithSpeed.length > 0) {
                    const lastLap = lapsWithSpeed[lapsWithSpeed.length - 1];
                    if (lastLap.avg_speed_kmh && lastLap.avg_speed_kmh > 0 && lastLap.avg_speed_kmh < 400) {
                        speedsMap[driver.driver_id] = lastLap.avg_speed_kmh;
                    }
                }
            } catch (e) { console.warn("Error obteniendo velocidad:", e); }
        }
    }
    console.log("📊 speedsMap en TableroPublico:", speedsMap);

    const finishedDrivers = leaderboard.filter(d => d.is_finished && d.total_time > 0);
    const allFinished = leaderboard.length > 0 && finishedDrivers.length === leaderboard.length;
    const finalDriverTime = finishedDrivers.length ? Math.max(...finishedDrivers.map(d => Number(d.total_time) || 0)) : 0;

    if (raceTimer) {
        if (allFinished && finalDriverTime > 0) {
            raceTimer.innerText = formatRaceClock(finalDriverTime);
        } else {
            let seconds = session.race_elapsed_seconds || 0;
            if (session.status === 'active') {
                seconds += (Date.now() - raceTimerState.lastSyncMs) / 1000;
            }
            raceTimer.innerText = formatRaceClock(seconds);
        }
    }

    const finishedOrder = leaderboard
        .filter(d => d.is_finished && d.total_laps >= (session.laps_limit || 0))
        .sort((a, b) => (a.total_time || 0) - (b.total_time || 0));

    if (!leaderboard.length) {
        listaPilotos.innerHTML = '';
        return;
    }

    listaPilotos.innerHTML = leaderboard.map((driver, idx) => {
        const color = driverColors[idx % driverColors.length];
        const best = driver.best_lap != null ? formatRaceClock(driver.best_lap) : '--';
        const totalTime = driver.total_time != null ? formatRaceClock(driver.total_time) : '--';
        const individualTime = timesMap[driver.driver_id] || '--';
        const speed = speedsMap[driver.driver_id];
        const speedFormatted = (speed && speed > 0) ? `${Math.round(speed)} km/h` : '--';
        const rowClass = idx === 0 ? 'row-first' : '';
        const progressLineClass = idx === 0 ? 'line-gold' : 'line-blue';
        const kartIdValue = typeof driver.kart_id === 'string' ? driver.kart_id.trim() : driver.kart_id;
        const kartLabel = kartIdValue ? kartIdValue : driver.transponder_id || '--';

        let cupIcon = '';
        if (driver.is_finished && driver.total_laps >= (session.laps_limit || 0)) {
            const posInFinished = finishedOrder.findIndex(d => d.driver_id === driver.driver_id);
            if (posInFinished === 0) cupIcon = ' 🏆';
            else if (posInFinished === 1) cupIcon = ' 🥈';
            else if (posInFinished === 2) cupIcon = ' 🥉';
        }

        console.log(`Piloto ${driver.full_name}: speed =`, speed, "formateado =", speedFormatted);

        return `
                    <div class="k-row ${rowClass}">
                        <div class="k-col-pos">${driver.position || (idx + 1)}</div>
                        <div class="k-col-name">
                            <span class="driver-name">${driver.full_name || driver.name}${cupIcon}</span>
                            <div class="progress-line ${progressLineClass}" style="background: linear-gradient(90deg, ${color}, transparent);"></div>
                        </div>
                        <div class="k-col-vueltas">${driver.total_laps || 0}/${session.laps_limit || 0}</div>
                        <div class="k-col-mejor"><span class="time-box box-gold">${best}</span></div>
                        <div class="k-col-tiempo"><span class="time-box box-black">${totalTime}</span></div>
                        <div class="k-col-tiempo-individual"><span class="time-box box-black">${individualTime}</span></div>
                        <div class="k-col-kart"><span class="kart-circle" style="background-color: ${color};">${kartLabel}</span></div>
                    </div>
                `;
    }).join('');
}


// Pilotos
async function loadDrivers() {
    console.log("🔵 loadDrivers iniciada");
    
    // ========== 1. LISTA DE PILOTOS REGISTRADOS ==========
    try {
        const drivers = await apiCall('/api/drivers');
        const tbody = document.getElementById('driversList');
        if (tbody) {
            if (drivers && drivers.length > 0) {
                tbody.innerHTML = drivers.map(d => `
                    <tr>
                        <td>${d.id}</td>
                        <td><span id="name-${d.id}">${d.name} ${d.lastname || ''}</span></td>
                        <td>${d.transponder_id || '--'}</td>
                        <td>
                            <button class="btn btn-sm" onclick="editDriverMinimal(${d.id}, '${d.name.replace(/'/g, "\\'")}', '${(d.lastname || '').replace(/'/g, "\\'")}', ${d.transponder_id})">✏️</button>
                            <button class="btn btn-sm" onclick="deleteDriver(${d.id})">🗑️</button>
                        </td>
                    </tr>
                `).join('');
                console.log("✅ Pilotos cargados:", drivers.length);
            } else {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No hay pilotos registrados</td></tr>';
            }
        }
    } catch (e) {
        console.error("Error cargando pilotos:", e);
        const tbody = document.getElementById('driversList');
        if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#ef7a86;">❌ Error al cargar pilotos</td></tr>';
    }

 
         // ========== 2. PILOTOS INSCRITOS EN CARRERA ==========
        try {
            const session = await apiCall('/api/session/current');
            const raceTbody = document.getElementById('raceDriversList');
            const inscritosCount = document.getElementById('inscritosCount');
            
            if (raceTbody) {
                if (session?.active && session?.session?.id) {
                    const raceDrivers = await apiCall(`/api/race/drivers/${session.session.id}`);
                    if (raceDrivers && raceDrivers.length > 0) {
                        // ✅ AGREGAR CONTADOR DE POSICIÓN (1, 2, 3...)
                        raceTbody.innerHTML = raceDrivers.map((d, index) => `
                            <tr>
                                <td style="text-align: center; font-weight: bold">${index + 1}</td>
                                <td>${d.name} ${d.lastname || ''}</td>
                                <td>${d.transponder_id}</td>
                                <td><button class="btn " onclick="removeFromRace(${d.driver_id})" style=" color: white;">❌</button></td>
                            </tr>
                        `).join('');
                        // Actualizar contador
                        if (inscritosCount) inscritosCount.innerText = raceDrivers.length;
                        console.log("✅ Pilotos inscritos cargados:", raceDrivers.length);
                    } else {
                        raceTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Sin pilotos inscritos</td></tr>';
                        if (inscritosCount) inscritosCount.innerText = '0';
                    }
                } else {
                    raceTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No hay carrera activa</td></tr>';
                    if (inscritosCount) inscritosCount.innerText = '0';
                }
            }
        } catch (e) {
            console.error("Error cargando pilotos inscritos:", e);
            const raceTbody = document.getElementById('raceDriversList');
            if (raceTbody) raceTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#ef7a86;">❌ Error al cargar inscritos</td><tr>';
            const inscritosCount = document.getElementById('inscritosCount');
            if (inscritosCount) inscritosCount.innerText = '0';
        }

    // ========== 3. SELECT PARA INSCRIBIR ==========
// ========== 3. SELECT PARA INSCRIBIR (FILTRANDO YA INSCRITOS) ==========
try {
    const drivers = await apiCall('/api/drivers');
    const session = await apiCall('/api/session/current');
    
    let inscritosIds = [];
    if (session?.active && session?.session?.id) {
        const raceDrivers = await apiCall(`/api/race/drivers/${session.session.id}`);
        inscritosIds = raceDrivers ? raceDrivers.map(d => d.driver_id) : [];
    }
    
    const select = document.getElementById('selectDriverToAdd');
    if (select && drivers) {
        // Filtrar pilotos que NO están inscritos
        const disponibles = drivers.filter(d => !inscritosIds.includes(d.id));
        
        select.innerHTML = '<option value="">-- Seleccionar Piloto --</option>' + 
            disponibles.map(d => `<option value="${d.id}" data-transponder="${d.transponder_id}">${d.name} ${d.lastname || ''} (${d.transponder_id})</option>`).join('');
        
        if (disponibles.length === 0 && drivers.length > 0) {
            select.innerHTML = '<option value="">-- Todos los pilotos ya están inscritos --</option>';
        }
    }
} catch (e) {
    console.error("Error cargando select:", e);
}
}

window.deleteDriver = async (id) => {
    showModal('Eliminar Piloto', '¿Eliminar este piloto?', async () => {
        await apiCall(`/api/drivers/${id}`, { method: 'DELETE' });
        loadDrivers();
        loadTransponders();
    });
};

window.editDriver = (id, name, lastname, transponder) => {
    document.getElementById('driverName').value = name;
    document.getElementById('driverLastname').value = lastname;
    document.getElementById('driverTransponder').value = transponder;

    const saveBtn = document.getElementById('saveDriverBtn');
    const originalText = saveBtn.innerText;
    saveBtn.innerText = '💾 ACTUALIZAR PILOTO';
    saveBtn.className = 'btn btn-warning';
    saveBtn.style.width = '100%';

    saveBtn.onclick = async () => {
        const data = {
            name: document.getElementById('driverName').value,
            lastname: document.getElementById('driverLastname').value,
            transponder_id: parseInt(document.getElementById('driverTransponder').value)
        };

        showLoader('Actualizando piloto...');
        const res = await apiCall(`/api/drivers/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        hideLoader();

        if (res?.success) {
            saveBtn.innerText = originalText;
            saveBtn.className = 'btn btn-primary';
            saveBtn.onclick = createDriverHandler; // Restaurar el handler original
            document.getElementById('driverName').value = '';
            document.getElementById('driverLastname').value = '';
            document.getElementById('driverTransponder').value = '';
            loadDrivers();
        }
    };
};

const createDriverHandler = async () => {
    const data = {
        transponder_id: parseInt(document.getElementById('driverTransponder').value),
        name: document.getElementById('driverName').value,
        lastname: document.getElementById('driverLastname').value
    };
    if (!data.transponder_id || !data.name) { return; }

    showLoader('Guardando piloto...');
    const res = await apiCall('/api/drivers', { method: 'POST', body: JSON.stringify(data) });
    hideLoader();

    if (res?.success) {
        document.getElementById('driverTransponder').value = '';
        document.getElementById('driverName').value = '';
        document.getElementById('driverLastname').value = '';
        loadDrivers();
        loadTransponders();
    }
};

document.getElementById('saveDriverBtn').onclick = createDriverHandler;

window.removeFromRace = async (driverId) => {
    const session = await apiCall('/api/session/current');
    if (session?.active && session?.session?.status !== 'completed') {
        showLoader('Eliminando de la carrera...');
        await apiCall('/api/race/remove', {
            method: 'POST',
            body: JSON.stringify({
                session_id: session.session.id,
                driver_id: driverId
            })
        });
        hideLoader();
        loadDrivers();
        loadLiveData();
    }
};

document.getElementById('addDriverToRaceBtn').onclick = async () => {
    const select = document.getElementById('selectDriverToAdd');
    const driverId = select.value;
    if (!driverId) { 
        showToast('⚠️', 'Selecciona un piloto primero', 'warning');
        return; 
    }
    
    const session = await apiCall('/api/session/current');
    if (!session?.active || session?.session?.status === 'completed') {
        showToast('⚠️', 'No hay carrera activa o ya finalizó', 'warning');
        return; 
    }
    
    const drivers = await apiCall('/api/drivers');
    const driver = drivers.find(d => d.id == driverId);
    if (!driver) { 
        showToast('❌', 'Piloto no encontrado', 'error');
        return; 
    }
    
    // ✅ VERIFICAR SI YA ESTÁ INSCRITO
    const raceDrivers = await apiCall(`/api/race/drivers/${session.session.id}`);
    const yaInscrito = raceDrivers && raceDrivers.some(d => d.driver_id == driverId);
    
    if (yaInscrito) {
        showToast('⚠️', `El piloto ${driver.name} ${driver.lastname || ''} YA está inscrito en esta carrera`, 'warning');
        return;
    }
    
    showLoader('Inscribiendo piloto...');
    const res = await apiCall('/api/race/add', { 
        method: 'POST', 
        body: JSON.stringify({ 
            session_id: session.session.id, 
            driver_id: parseInt(driverId), 
            transponder_id: driver.transponder_id 
        }) 
    });
    hideLoader();
    
    if (res?.success) { 
        showToast('✅', `Piloto ${driver.name} inscrito correctamente`, 'success');
        loadDrivers();  // Recargar listas
        loadLiveData(); // Actualizar tablero
    } else {
        showToast('❌', res?.error || 'No se pudo inscribir el piloto', 'error');
    }
};

// Transponders
async function loadTransponders() {
    const detected = await apiCall('/api/transponders/unassigned');
    const detectedTbody = document.getElementById('detectedTranspondersList');
    if (detectedTbody) {
        if (detected?.length) {
            detectedTbody.innerHTML = detected.map(t => `<tr><td>${t.id}</td><td>${t.kart_id || '--'}</td><td>${t.description || '--'}</td><td><button class="btn btn-sm" style="padding: 0.8rem;"  onclick="assignTransponder(${t.id})">👤 Asignar</button></td></tr>`).join('');
        } else {
            detectedTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Sin transponders detectados</td></tr>';
        }
    }

    const all = await apiCall('/api/transponders/all');
    allTranspondersCache = all || [];
    const allTbody = document.getElementById('allTranspondersList');
    if (allTbody) {
        if (all?.length) {
            const drivers = await apiCall('/api/drivers');
            allTbody.innerHTML = all.map(t => {
                const assigned = drivers?.find(d => d.transponder_id === t.id);
                const actionButtons = `
                            <button class="btn btn-sm" onclick="editTransponder(${t.id})">✏️</button>
                            ${assigned ? '' : `<button class="btn btn-sm" onclick="deleteTransponder(${t.id})">🗑️</button>`}
                        `;
                return `<tr>
                            <td>${t.id}</td>
                            <td>${t.kart_id || '--'}</td>
                            <td>${t.description || '--'}</td>
                            <td>${assigned ? `${assigned.name} ${assigned.lastname || ''}` : 'Sin asignar'}</td>
                            <td>${actionButtons}</td>
                        </tr>`;
            }).join('');
        } else {
            allTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No hay transponders registrados</td></tr>';
        }
    }
}

window.editTransponderId = (id) => {
    const newId = prompt('Ingrese el nuevo ID para el transponder:', id);
    if (newId && newId != id) {
        const numId = parseInt(newId);
        if (isNaN(numId)) {
            showToast('❌', 'El ID debe ser un número válido.', 'error');
            return;
        }
        showModal('Editar Transponder', `¿Cambiar el ID ${id} por ${numId}?`, async () => {
            showLoader('Actualizando transponder...');
            const res = await apiCall(`/api/transponders/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ new_id: numId })
            });
            hideLoader();
            if (res?.success) {
                loadTransponders();
            } else {
                showToast('❌', res.error || 'No se pudo actualizar el transponder.', 'error');
            }
        });
    }
};

// ==================== MODAL COMPLETO PARA EDITAR TRANSPONDER ====================
let editingTransponderData = null;

window.editTransponder = async (id) => {
    const transponder = allTranspondersCache.find(t => t.id === id);
    if (!transponder) {
        showToast('❌', 'Transponder no encontrado.', 'error');
        return;
    }

    editingTransponderData = { oldId: id };

    // Llenar el modal con los datos actuales
    document.getElementById('editModalTransponderId').value = transponder.id;
    document.getElementById('editModalKartId').value = transponder.kart_id || '';
    document.getElementById('editModalDesc').value = transponder.description || '';

    // Mostrar modal
    document.getElementById('editTransponderFullModal').style.display = 'flex';
    document.getElementById('editModalTransponderId').focus();
};

// Configurar eventos del modal
function setupEditModalEvents() {
    const modal = document.getElementById('editTransponderFullModal');
    if (!modal) return;

    const closeModal = () => {
        modal.style.display = 'none';
        editingTransponderData = null;
    };

    document.getElementById('editModalCancelBtn').onclick = closeModal;

    document.getElementById('editModalConfirmBtn').onclick = async () => {
        const newId = parseInt(document.getElementById('editModalTransponderId').value);
        const kartId = document.getElementById('editModalKartId').value.trim();
        const desc = document.getElementById('editModalDesc').value.trim();
        const oldId = editingTransponderData.oldId;

        if (isNaN(newId)) {
            showToast('Error', 'El ID debe ser un número válido.', 'error');
            return;
        }

        showLoader('Guardando cambios...');

        // 1. Si el ID cambió, actualizarlo
        if (newId !== oldId) {
            // Verificar que el nuevo ID no exista
            const allTransponders = await apiCall('/api/transponders/all');
            if (allTransponders && allTransponders.some(t => t.id === newId)) {
                hideLoader();
                showToast('Error', `El ID ${newId} ya está en uso.`, 'error');
                return;
            }

            const idRes = await apiCall(`/api/transponders/${oldId}`, {
                method: 'PUT',
                body: JSON.stringify({ new_id: newId })
            });

            if (!idRes?.success) {
                hideLoader();
                showToast('❌', idRes?.error || 'No se pudo cambiar el ID.', 'error');
                return;
            }
        }

        // 2. Actualizar Kart y descripción (usando el nuevo ID o el viejo)
        const targetId = (newId !== oldId) ? newId : oldId;
        const detailsRes = await apiCall(`/api/transponders/${targetId}/details`, {
            method: 'PUT',
            body: JSON.stringify({ kart_id: kartId, description: desc })
        });

        hideLoader();

        if (detailsRes?.success) {
            showToast('✅', 'Transponder actualizado correctamente', 'success');
            closeModal();
            loadTransponders();
            loadTransponderHealth();
        } else {
            showToast('❌', detailsRes?.error || 'Error al actualizar', 'error');
        }
    };

    // Clic fuera cierra
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    // Escape cierra
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });
}


// Inicializar eventos
setupEditModalEvents();

const resetTransponderEditMode = () => {
    editingTransponderId = null;
    document.getElementById('manualTransponderId').disabled = false;
    document.getElementById('manualTransponderId').value = '';
    document.getElementById('manualTransponderKart').value = '';
    document.getElementById('manualTransponderDesc').value = '';
    document.getElementById('addTransponderBtn').textContent = 'Agregar';
    document.getElementById('cancelEditTransponderBtn').style.display = 'none';
};

window.deleteTransponder = (id) => {
    showModal('Eliminar Transponder', `¿Eliminar el transponder ${id}?`, async () => {
        showLoader('Eliminando transponder...');
        const res = await apiCall(`/api/transponders/${id}`, { method: 'DELETE' });
        hideLoader();
        if (res?.success) {
            loadTransponders();
        } else {
            showToast(res.error || 'Error al eliminar', 'error');
        }
    });
};

window.assignTransponder = (id) => {
    // Mostrar loader
    showLoader(`Transponder ${id} listo para asignar. Completa el formulario.`);

    // Asignar valor y cambiar de panel
    document.getElementById('driverTransponder').value = id;
    document.querySelector('[data-panel="drivers"]').click();

    // Ocultar loader después de 2 segundos
    setTimeout(() => {
        hideLoader();
    }, 2000);
};

document.getElementById('addTransponderBtn').onclick = async () => {
    const id = parseInt(document.getElementById('manualTransponderId').value);
    const kartId = document.getElementById('manualTransponderKart').value.trim();
    const desc = document.getElementById('manualTransponderDesc').value.trim();
    if (!id) {
        showToast('Ingrese el código del transponder', 'error');
        return;
    }

    if (editingTransponderId) {
        showLoader('Guardando cambios...');
        const res = await apiCall(`/api/transponders/${editingTransponderId}/details`, {
            method: 'PUT',
            body: JSON.stringify({ kart_id: kartId, description: desc })
        });
        hideLoader();

        if (res?.success) {
            resetTransponderEditMode();
            loadTransponders();
        } else {
            showToast(res.error || 'Error al actualizar transponder', 'error');
        }
        return;
    }

    showLoader('Registrando transponder...');
    const res = await apiCall('/api/transponders/manual/extended', {
        method: 'POST',
        body: JSON.stringify({ id, kart_id: kartId, description: desc })
    });
    hideLoader();

    if (res?.success) {
        document.getElementById('manualTransponderId').value = '';
        document.getElementById('manualTransponderKart').value = '';
        document.getElementById('manualTransponderDesc').value = '';
        loadTransponders();
    } else {
        showToast(res.error || 'Error al registrar transponder', 'error');
    }
};

document.getElementById('cancelEditTransponderBtn').onclick = () => {
    resetTransponderEditMode();
};

// Nueva carrera
document.getElementById('createNewRaceBtn').onclick = () => {
    const name = document.getElementById('newCircuitName').value;
    const laps = document.getElementById('newLapsLimit').value;
    const raceMode = document.getElementById('newRaceMode') ? document.getElementById('newRaceMode').value : 'position';
    if (!name) {
        showToast('⚠️', 'Ingresa un nombre para la carrera', 'warning');
        return;
    }

    showModal('Nueva Carrera', `¿Crear carrera "${name}" con ${laps} vueltas?`, async () => {
        showLoader('Creando nueva carrera...');

        try {
            const res = await apiCall('/api/race/create-new', {
                method: 'POST',
                body: JSON.stringify({
                    next_race_name: name,
                    next_race_laps: parseInt(laps),
                    next_race_mode: raceMode
                })
            });

            if (res?.success) {
                showToast('✅', `Carrera "${name}" creada`, 'success');
                // ✅ FORZAR RECARGA COMPLETA DE DATOS
                await loadLiveData();
                await loadDrivers();  // Recargar lista de pilotos inscritos
                // Limpiar el select de inscripción también
                const select = document.getElementById('selectDriverToAdd');
                if (select) select.innerHTML = '<option value="">-- Seleccionar Piloto --</option>';
            } else {
                showToast('❌', res?.error || 'No se pudo crear la carrera', 'error');
            }
        } catch (error) {
            console.error('Error createRace:', error);
            showToast('❌', 'Error al crear carrera', 'error');
        } finally {
            hideLoader();
        }
    });
};

document.getElementById('resetUsbBtn').onclick = () => {
    showModal('Preparar USB', '¿Preparar USB para desconectar con seguridad?', async () => {
        showLoader('Preparando USB...');
        await apiCall('/api/usb/reset', { method: 'POST' });
        hideLoader();
    });
};


document.getElementById('resetBoardBtn').onclick = () => {
    showModal('Resetear Tablero', '¿Estás seguro? Se eliminarán los pilotos inscritos, las vueltas y la carrera completa.', async () => {
        saveLoginBeforeReload();
        showLoader('Limpiando tablero...');

        try {
            const res = await apiCall('/api/race/reset', { method: 'POST' });

            if (res?.success) {
                showToast('✅', 'Tablero reseteado', 'success');
                // Esperar un momento antes de recargar datos
                await new Promise(r => setTimeout(r, 500));
                await loadLiveData();
                // Cambiar al panel de control de carrera

            } else {
                showToast('❌', res?.error || 'No se pudo resetear', 'error');
            }
        } catch (error) {
            console.error('Error en resetBoard:', error);
            showToast('❌', 'Error al resetear tablero', 'error');
        } finally {
            hideLoader();
        }
    });
};

document.getElementById('hardResetBtn').onclick = () => {
    showModal('Reinicio Forzado Total', '⚠️⚠️⚠️ ADVERTENCIA ⚠️⚠️⚠️\n\nEsta acción BORRARÁ TODOS los datos (pilotos, transponders, vueltas, carreras).\n\nSe creará un respaldo automático antes de borrar.\n\n¿Estás seguro?', async () => {
        saveLoginBeforeReload();
        showLoader('Ejecutando reinicio forzado total...');

        try {
            const res = await apiCall('/api/race/clear-all', { method: 'POST' });

            if (res?.success) {
                showToast('✅', 'Reinicio completado', 'success');
                await loadLiveData();
            } else {
                showToast('❌', res?.error || 'No se pudo ejecutar el reinicio forzado', 'error');
            }
        } catch (error) {
            console.error('Error en hardReset:', error);
            showToast('❌', 'Error al conectar con el servidor', 'error');
        } finally {
            hideLoader();
        }
    });
};

function setRaceButtonsEnabled(enabled) {
    ['startRaceBtn', 'pauseRaceBtn', 'resumeRaceBtn', 'repeatRaceBtn', 'resetBoardBtn', 'finishRaceBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !enabled;
    });
}

window.resetTransponderHealth = async (transponderId) => {
    showLoader(`Reiniciando estado del transponder ${transponderId}...`);
    const res = await apiCall(`/api/transponders/health/${transponderId}/reset`, { method: 'POST' });
    hideLoader();
    if (res?.success) {
        showToast('✅', 'Estado reiniciado', 'success');
        loadTransponderHealth();
    } else {
        showToast(res?.error || 'No se pudo reiniciar el estado', 'error');
    }
};

async function runCountdown(seconds, speed) {
    const overlay = document.getElementById('countdownOverlay');
    const numberEl = document.getElementById('countdownNumber');
    const hintEl = document.getElementById('countdownHint');

    if (!overlay) return false;

    // Forzar estilos por si acaso
    overlay.style.display = 'flex';

    // Ajustar tamaño según pantalla (opcional, el CSS ya lo hace)
    if (window.innerWidth <= 768) {
        numberEl.style.fontSize = '5rem';
        hintEl.style.fontSize = '0.9rem';
    } else {
        numberEl.style.fontSize = '12rem';
        hintEl.style.fontSize = '1.2rem';
    }

    let n = seconds;
    while (n > 0) {
        numberEl.innerText = n;
        hintEl.innerText = (n <= 3) ? '¡LISTOS!' : 'PREPÁRENSE';
        await new Promise(r => setTimeout(r, speed * 1000));
        n--;
    }
    numberEl.innerText = '0';
    hintEl.innerText = '¡GO!';
    await new Promise(r => setTimeout(r, 800));
    overlay.style.display = 'none';
    await new Promise(r => setTimeout(r, 500));
    console.log("✅ Countdown finalizado, retornando true");
    return true;
}

// Botones de control de carrera
document.getElementById('startRaceBtn').onclick = async () => {
    const totalDrivers = parseInt(document.getElementById('totalDrivers').innerText) || 0;
    if (totalDrivers === 0) {
        showModal('🚫 SIN PILOTOS', 'No hay pilotos inscritos en la carrera.', () => { });
        return;
    }
    
    // ✅ Verificar el estado del modo simulación (desde el toggle)
    const simulationToggle = document.getElementById('simulationModeToggle');
    const isSimulationActive = simulationToggle ? simulationToggle.checked : false;
    
    // ✅ Si NO está en modo simulación, verificar decoder
    if (!isSimulationActive) {
        try {
            const decoderStatus = await apiCall('/api/decoder/status');
            if (!decoderStatus?.connected) {
                showModal('⚠️ DECODER NO CONECTADO', 
                    'El hardware ESL-400 no está conectado.\n\n'
                    + 'Para pruebas sin hardware:\n'
                    + '1. Ve al panel SISTEMA\n'
                    + '2. Activa el interruptor "🎮 Simulación"\n'
                    + '3. Luego inicia la carrera', 
                    () => {});
                return;  // ← IMPORTANTE: Bloquear el inicio
            }
        } catch (e) {
            console.error("Error verificando decoder:", e);
            showModal('⚠️ ERROR DE COMUNICACIÓN', 
                'No se pudo verificar el estado del decoder.\n\n'
                + 'Asegúrate de que el hardware esté conectado o activa el modo simulación.', 
                () => {});
            return;
        }
    } else {
        showToast('🎮', 'Modo simulación activado - Generando vueltas automáticas', 'info');
    }

    const currentData = await apiCall('/api/session/current');
    if (currentData?.active && currentData.session?.status === 'active') {
        showModal('⚠️ CARRERA ACTIVA', 'Ya hay una carrera en curso.', () => { });
        return;
    }

    showModal('Iniciar Carrera', '¿Iniciar la carrera?', async () => {
        try {
            setRaceButtonsEnabled(false);

            const currentData = await apiCall('/api/session/current');
            const raceName = currentData?.session?.circuit_name || 'Circuito Principal';
            const lapsLimit = currentData?.session?.laps_limit || 10;

            await showRaceStartSplash(raceName, lapsLimit);

            const countdownSeconds = getCountdownDuration();
            const countdownSpeed = getCountdownSpeed();
            const completed = await runCountdown(countdownSeconds, countdownSpeed);

            if (completed) {
                console.log("🚦 Countdown completado, esperando 1 segundo antes de enviar START...");
                await new Promise(r => setTimeout(r, 1000));

                console.log("🚦 Enviando comando START...");
                showLoader('Iniciando carrera...');

                // SOLO UNA LLAMADA - Esta es la correcta
                const res = await apiCall('/api/race/start', { method: 'POST' });
                console.log("📡 Respuesta:", res);

                if (res?.success) {
                    await new Promise(r => setTimeout(r, 500));
                    hideLoader();
                    await loadLiveData();

                    // Verificar que la carrera realmente inició
                    const checkData = await apiCall('/api/session/current');
                    if (checkData?.session?.status !== 'active') {
                        console.warn("⚠️ Carrera no activa, reintentando...");
                        await apiCall('/api/race/start', { method: 'POST' });
                        setTimeout(() => loadLiveData(), 500);
                    }
                } else {
                    hideLoader();
                    showModal('❌ ERROR', 'No se pudo iniciar la carrera.', () => { });
                }
            }
        } catch (error) {
            console.error("Error:", error);
            hideLoader();
        } finally {
            setRaceButtonsEnabled(true);
        }
    });
};
document.getElementById('pauseRaceBtn').onclick = async () => {
    showLoader('Pausando carrera...');
    const res = await apiCall('/api/race/pause', { method: 'POST' });
    hideLoader();
    if (res?.success) {
        loadLiveData(); // Actualizar botones inmediatamente
    }
};

document.getElementById('resumeRaceBtn').onclick = async () => {
    showLoader('Reanudando carrera...');
    const res = await apiCall('/api/race/resume', { method: 'POST' });
    hideLoader();
    if (res?.success) {
        loadLiveData(); // Actualizar botones inmediatamente
    }
};

document.getElementById('repeatRaceBtn').onclick = async () => {
    saveLoginBeforeReload();
    showModal('Repetir Carrera', '¿Repetir la misma carrera con los mismos pilotos? Se conservarán los inscritos y solo se reiniciarán sus vueltas y tiempos.', async () => {
        showLoader('Reiniciando sistema con los mismos pilotos...');
        const res = await apiCall('/api/race/repeat', { method: 'POST' });
        hideLoader();

        if (res?.success) {
            showToast('✅', 'Carrera repetida correctamente', 'success');
            await loadLiveData();  // Actualizar datos sin recargar
        } else {
            showToast('❌', res?.error || 'No se pudo repetir la carrera', 'error');
        }
    });
};

document.getElementById('finishRaceBtn').onclick = async () => {
    showModal('Finalizar Carrera', '¿Finalizar la carrera actual? Se guardarán los resultados.', async () => {
        showLoader('Finalizando carrera...');
        const res = await apiCall('/api/race/finish', { method: 'POST' });
        if (res?.success) {
            hideLoader();
            setTimeout(async () => {
                await loadLiveData();
                const podiumRes = await apiCall('/api/session/current/podium');
                const podium = podiumRes?.podium || [];
                if (podium.length) {
                    resetWinnerModalFlag();
                    showWinnerModalComplete(podium[0], podium[1], podium[2]);
                }
            }, 400);
        } else {
            hideLoader();
            showToast(res?.error || 'No se pudo finalizar la carrera', 'error');
        }
    });
};

// ========== FUNCIONES MODAL GANADOR ==========

// ========== MODAL CON 3 GANADORES ==========
let winnerModalShown = false;

function winnerDetailsText(driver) {
    if (!driver) return '--';
    const kart = driver.kart_id || '--';
    const transponder = driver.transponder_id || '--';
    const mode = normalizeRaceMode(currentRaceMode);
    const bestLap = driver.best_lap != null ? `${Number(driver.best_lap).toFixed(3)} s` : '--';
    const total = driver.total_time != null ? formatRaceClock(driver.total_time) : '--';
    const laps = driver.total_laps != null ? String(driver.total_laps) : '--';
    
    if (mode === 'time_attack') {
        return `⏱️ TIME ATTACK | Kart ${kart} | ${laps} v | Total ${total} | Mejor ${bestLap}`;
    }
    return `🏁 POSITION RACE | Kart ${kart} | ${laps} v | Total ${total} | Mejor ${bestLap}`;
}

let winnerModalTimer = null;

function showWinnerModalComplete(winner, second, third) {
    if (winnerModalShown) return;
    winnerModalShown = true;

    // Actualizar contenido del modal
    document.getElementById('modalWinnerName').innerText = winner.full_name || winner.name;
    document.getElementById('modalWinnerTime').innerText = winnerDetailsText(winner);

    const secondContainer = document.getElementById('modalSecondContainer');
    if (secondContainer) {
        if (second) {
            document.getElementById('modalSecondName').innerText = second.full_name || second.name;
            document.getElementById('modalSecondTime').innerText = winnerDetailsText(second);
            secondContainer.style.display = 'block';
        } else {
            secondContainer.style.display = 'none';
        }
    }

    const thirdContainer = document.getElementById('modalThirdContainer');
    if (thirdContainer) {
        if (third) {
            document.getElementById('modalThirdName').innerText = third.full_name || third.name;
            document.getElementById('modalThirdTime').innerText = winnerDetailsText(third);
            thirdContainer.style.display = 'block';
        } else {
            thirdContainer.style.display = 'none';
        }
    }

    const modal = document.getElementById('winnerModalComplete');
    modal.style.display = 'flex';

    // Cerrar automáticamente después de 15 segundos
    if (winnerModalTimer) clearTimeout(winnerModalTimer);
    winnerModalTimer = setTimeout(() => {
        closeWinnerModalComplete();
    }, 15000);

    // Cerrar al hacer click fuera del contenido del modal
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeWinnerModalComplete();
        }
    };
}

function closeWinnerModalComplete() {
    if (winnerModalTimer) {
        clearTimeout(winnerModalTimer);
        winnerModalTimer = null;
    }
    document.getElementById('winnerModalComplete').style.display = 'none';
}

function resetWinnerModalFlag() {
    winnerModalShown = false;
}
// ========== FIN MODAL 3 GANADORES ==========



// ========== CONFIGURACIÓN DE CUENTA REGRESIVA ==========

function sliderToCountdownSeconds(sliderValue) {
    // Izquierda (0.3) = lento (2.0s), derecha (2.0) = rapido (0.3s)
    const raw = Number(sliderValue);
    const safe = Number.isFinite(raw) ? raw : 1;
    return Number((2.3 - safe).toFixed(2));
}

function countdownSecondsToSlider(secondsValue) {
    const raw = Number(secondsValue);
    const safe = Number.isFinite(raw) ? raw : 1;
    const slider = 2.3 - safe;
    return Math.min(2, Math.max(0.3, Number(slider.toFixed(2))));
}

// Cargar configuración guardada
function loadCountdownConfig() {
    // Duración total
    let duration = localStorage.getItem('chronit_countdown_duration');
    if (duration) {
        duration = parseInt(duration);
        if (isNaN(duration) || duration < 3) duration = 10;
        if (duration > 20) duration = 20;
    } else {
        duration = 10;
    }

    // Velocidad de descuento (intervalo entre números)
    let speed = localStorage.getItem('chronit_countdown_speed');
    if (speed) {
        speed = parseFloat(speed);
        if (isNaN(speed) || speed < 0.3) speed = 1;
        if (speed > 2) speed = 2;
    } else {
        speed = 1;
    }

    // Aplicar a los inputs
    const durationSlider = document.getElementById('countdownDurationSlider');
    const durationInput = document.getElementById('countdownDuration');
    const speedSlider = document.getElementById('countdownSpeedSlider');
    const speedHint = document.getElementById('speedHint');

    if (durationSlider) durationSlider.value = duration;
    if (durationInput) durationInput.value = duration;
    if (speedSlider) {
        speedSlider.value = countdownSecondsToSlider(speed);
        if (speedHint) speedHint.innerText = `Cada número se mostrará durante ${speed.toFixed(2)} segundos`;
    }

    return { duration, speed };
}



// Sincronizar controles
function setupCountdownControls() {
    const durationSlider = document.getElementById('countdownDurationSlider');
    const durationInput = document.getElementById('countdownDuration');
    const speedSlider = document.getElementById('countdownSpeedSlider');
    const speedHint = document.getElementById('speedHint');
    const saveBtn = document.getElementById('saveCountdownConfigBtn');

    // Sincronizar duración: slider ↔ input
    if (durationSlider && durationInput) {
        durationSlider.oninput = () => {
            durationInput.value = durationSlider.value;
        };
        durationInput.onchange = () => {
            let val = parseInt(durationInput.value);
            if (isNaN(val)) val = 10;
            if (val < 3) val = 3;
            if (val > 20) val = 20;
            durationSlider.value = val;
            durationInput.value = val;
        };
    }

    // Mostrar hint de velocidad
    if (speedSlider && speedHint) {
        speedSlider.oninput = () => {
            const val = sliderToCountdownSeconds(speedSlider.value);
            speedHint.innerText = `Cada número se mostrará durante ${val.toFixed(2)} segundos`;
        };
    }

    // Guardar configuración
    if (saveBtn) {
        saveBtn.onclick = () => {
            const duration = parseInt(durationSlider.value);
            const speed = sliderToCountdownSeconds(speedSlider.value);
            localStorage.setItem('chronit_countdown_duration', duration);
            localStorage.setItem('chronit_countdown_speed', speed);
            showToast('✅ Configuración guardada', `Cuenta regresiva: ${duration}s, ritmo ${speed.toFixed(2)}s`, 'success');
        };
    }
}

// Obtener duración total
function getCountdownDuration() {
    const input = document.getElementById('countdownDuration');
    if (input) {
        let val = parseInt(input.value);
        if (isNaN(val)) val = 10;
        if (val < 3) val = 3;
        if (val > 20) val = 20;
        return val;
    }
    return 10;
}

// Obtener velocidad de descuento (intervalo entre números)
function getCountdownSpeed() {
    // Primero intentar leer del localStorage (configuración guardada)
    let speed = localStorage.getItem('chronit_countdown_speed');
    if (speed) {
        speed = parseFloat(speed);
        if (!isNaN(speed) && speed >= 0.3 && speed <= 2) {
            return speed;
        }
    }
    // Si no hay configuración guardada, usar el slider
    const slider = document.getElementById('countdownSpeedSlider');
    if (slider) {
        let val = sliderToCountdownSeconds(slider.value);
        if (isNaN(val)) val = 1;
        if (val < 0.3) val = 0.3;
        if (val > 2) val = 2;
        return val;
    }
    return 1;
}
// ========== FIN CONFIGURACIÓN DE CUENTA REGRESIVA ==========

loadCountdownConfig();
setupCountdownControls();

// ✅ LLAMADAS EXISTENTES
loadLiveData();
loadTransponderHealth();
setInterval(renderRaceClock, 1000);
setInterval(() => {
    tvRotationIndex += 1;
    renderTvLapRotator();
    const clock = document.getElementById('tvClock');
    if (clock) clock.innerText = new Date().toLocaleTimeString();
}, 5000);
/////////
setInterval(loadLiveData, 300);


document.getElementById('showWinnerBtn').onclick = async () => {
    const podiumRes = await apiCall('/api/session/current/podium');
    const podium = podiumRes?.podium || [];
    if (podiumRes?.race_mode) currentRaceMode = normalizeRaceMode(podiumRes.race_mode);
    if (podium.length) {
        resetWinnerModalFlag();
        showWinnerModalComplete(podium[0], podium[1], podium[2]);
    }
};

// ========== GESTIÓN DE BASE DE DATOS ==========

async function loadDbStats() {
    const stats = await apiCall('/api/db/stats');
    if (stats) {
        document.getElementById('statDrivers').innerText = stats.drivers || 0;
        document.getElementById('statTransponders').innerText = stats.transponders || 0;
        document.getElementById('statSessions').innerText = stats.sessions || 0;
        document.getElementById('statLaps').innerText = stats.laps || 0;
        document.getElementById('statSize').innerText = stats.size_mb || 0;

        const badge = document.getElementById('dbSizeBadge');
        if (badge) {
            let color = '#63d297';
            if (stats.size_mb > 50) color = '#f4c06b';
            if (stats.size_mb > 100) color = '#ef7a86';
            badge.style.background = color;
            badge.innerText = `${stats.size_mb} MB`;
        }
    }
}

async function loadBackupsList() {
    const backups = await apiCall('/api/db/backups');
    const container = document.getElementById('backupsList');

    if (!backups || backups.length === 0) {
        container.innerHTML = '<p class="muted-text">No existe respaldos disponibles</p>';
        return;
    }

    container.innerHTML = backups.map(b => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid #2a3240;">
                <div>
                    <strong>${b.filename}</strong><br>
                    <small>📅 ${b.created} | 💾 ${b.size_mb} MB</small>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-sm" onclick="openBackupInSqlite('${b.filename}')" style="background:#2196f3;">👁️ Ver</button>
                    <button class="btn btn-sm" onclick="restoreBackup('${b.filename}')" style="background:#e5484d;">Restaurar</button>
                    <button class="btn btn-sm" onclick="deleteBackupFile('${b.filename}')" style="background:#ff9800;">🗑️ Eliminar</button>
                </div>
            </div>
        `).join('');
}
async function deleteBackupFile(filename) {
    if (!isAuthenticated || currentUser?.role !== 'admin') {
        showToast('❌', 'No tienes permisos', 'error');
        return;
    }

    showModal('⚠️ Eliminar Respaldo',
        `¿Estás seguro de que deseas eliminar el respaldo "${filename}"?\n\n⚠️ Esta acción no se puede deshacer.`,
        async () => {
            showLoader('Eliminando respaldo...');

            try {
                // Asegurar que el token se envía
                const token = sessionToken || localStorage.getItem('chronit_session_token');
                const res = await fetch(`/api/backup/delete/${filename}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Session-Token': token || ''
                    }
                });

                const result = await res.json();
                hideLoader();

                if (res.ok && result?.success) {
                    showToast('✅', result.message, 'success');
                    loadBackupsList();
                    loadDbStats();
                } else {
                    showToast('❌', result?.message || 'No se pudo eliminar', 'error');
                }
            } catch (e) {
                hideLoader();
                console.error('Error eliminando respaldo:', e);
                showToast('❌', 'Error al conectar con el servidor', 'error');
            }
        }
    );
}

async function deleteOldBackups(daysToKeep = 30) {
    if (!isAuthenticated || currentUser?.role !== 'admin') {
        showToast('❌ No tienes permisos para eliminar respaldos', 'error');
        return;
    }

    showModal('🗑️ Eliminar Respaldos Antiguos',
        `¿Eliminar respaldos con más de ${daysToKeep} días de antigüedad?\n\n⚠️ Esta acción no se puede deshacer.`,
        async () => {
            showLoader('Eliminando respaldos antiguos...');
            const res = await apiCall(`/api/backup/delete-old?days=${daysToKeep}`, { method: 'POST' });
            hideLoader();

            if (res?.success) {
                showToast(`✅ ${res.message}`, 'success');
                loadBackupsList();
                loadDbStats();
            } else {
                showToast(`❌ Error: ${res?.message}`);
            }
        }
    );
}

async function createBackup() {
    showLoader('Creando respaldo...');
    const res = await apiCall('/api/db/backup', { method: 'POST' });
    hideLoader();

    if (res?.success) {
        showToast(`✅ ${res.message}\n📁 Archivo: ${res.backup_file}`, 'success');
        loadBackupsList();
        loadDbStats();
    } else {
        showToast(`❌ Error: ${res?.message || 'No se pudo crear el respaldo'}`);
    }
}

async function softReset() {
    saveLoginBeforeReload();
    showModal('🧹 Limpieza Segura',
        'Esta acción BORRARÁ todas las vueltas y carreras, pero CONSERVARÁ pilotos y transponders.\n\n¿Deseas continuar?',
        async () => {
            showLoader('Realizando limpieza segura...');
            const res = await apiCall('/api/db/soft-reset', { method: 'POST' });
            hideLoader();

            if (res?.success) {
                showToast(`✅ ${res.message}\n📊 Vueltas borradas: ${res.details.laps_deleted}\n🏁 Carreras borradas: ${res.details.sessions_deleted}`, 'success');
                await loadLiveData();
            } else {
                showToast(`❌ Error: ${res?.message || 'No se pudo realizar la limpieza'}`, 'error');
            }
        }
    );
}

async function safeHardReset() {
    console.log("🟢 safeHardReset: Iniciando proceso");
    saveLoginBeforeReload();

    // Usar el modal con input de texto
    showConfirmTextModal(
        '⚠️ REINICIO TOTAL ⚠️',
        '⚠️⚠️⚠️ ADVERTENCIA ⚠️⚠️⚠️\n\nEsta acción BORRARÁ TODOS los datos (pilotos, transponders, vueltas, carreras).\n\nSe creará un respaldo automático antes de borrar.\n\nEscribe "BORRAR TODO" para confirmar:',
        'BORRAR TODO',
        async () => {
            console.log("🟢 Texto confirmado correctamente, ejecutando reinicio...");
            showLoader('Realizando reinicio total (con respaldo)...');

            try {
                console.log("🔵 Llamando a /api/db/safe-hard-reset...");
                const res = await apiCall('/api/db/safe-hard-reset', { method: 'POST' });
                console.log("🔵 Respuesta del servidor:", res);

                if (res?.success) {
                    console.log("🟢 ÉXITO: Reinicio completado");
                    showToast('✅ ÉXITO', res.message, 'success');
                    if (res.backup_file) {
                        showToast('📁 Respaldo', `Creado: ${res.backup_file}`, 'info');
                    }
                    await loadLiveData();
                    showToast('🔄', 'Datos actualizados', 'info');
                } else {
                    console.log("🔴 ERROR: Falló el reinicio", res?.message);
                    showToast('❌ ERROR', res?.message || 'No se pudo realizar el reinicio', 'error');
                }
            } catch (error) {
                console.error("🔴 EXCEPCIÓN en safeHardReset:", error);
                showToast('❌ ERROR', 'Error al conectar con el servidor', 'error');
            } finally {
                hideLoader();
                console.log("🟢 Proceso safeHardReset finalizado");
            }
        }
    );
}
// ==================== MODAL CON INPUT PARA CONFIRMAR ====================
let pendingConfirmCallback = null;

function showConfirmTextModal(title, message, expectedText, onConfirm) {
    document.getElementById('confirmTextModalTitle').innerText = title;
    document.getElementById('confirmTextModalMessage').innerText = message;
    document.getElementById('confirmTextModalInput').value = '';
    document.getElementById('confirmTextModal').style.display = 'flex';
    pendingConfirmCallback = { expectedText, onConfirm };
}

// Eventos del modal
document.getElementById('confirmTextModalCancel').onclick = () => {
    document.getElementById('confirmTextModal').style.display = 'none';
    pendingConfirmCallback = null;
};

document.getElementById('confirmTextModalConfirm').onclick = () => {
    const inputText = document.getElementById('confirmTextModalInput').value;
    if (pendingConfirmCallback && inputText === pendingConfirmCallback.expectedText) {
        document.getElementById('confirmTextModal').style.display = 'none';
        if (pendingConfirmCallback.onConfirm) pendingConfirmCallback.onConfirm();
    } else {
        showToast('⚠️', `Texto incorrecto. Escribe "${pendingConfirmCallback?.expectedText}" para confirmar.`, 'warning');
    }
    pendingConfirmCallback = null;
};

// Cerrar al hacer clic fuera
document.getElementById('confirmTextModal').onclick = (e) => {
    if (e.target === document.getElementById('confirmTextModal')) {
        document.getElementById('confirmTextModal').style.display = 'none';
        pendingConfirmCallback = null;
    }
};


async function restoreBackup(filename) {
    showModal('🔄 Restaurar Respaldo',
        `¿Restaurar el respaldo "${filename}"?\n\nLos datos actuales serán respaldados automáticamente antes de restaurar.`,
        async () => {
            showLoader('Restaurando respaldo...');
            const res = await apiCall(`/api/db/restore/${filename}`, { method: 'POST' });
            hideLoader();

            if (res?.success) {
                showToast(`✅ ${res.message}`, 'success');
                await loadLiveData();
            } else {
                showToast(`❌ Error: ${res?.message || 'No se pudo restaurar el respaldo'}`);
            }
        }
    );
}


// Botones de mantenimiento de BD
const backupBtn = document.getElementById('backupBtn');
const softResetBtn = document.getElementById('softResetBtn');
const safeHardResetBtn = document.getElementById('safeHardResetBtn');

if (backupBtn) backupBtn.onclick = createBackup;
if (softResetBtn) softResetBtn.onclick = softReset;
if (safeHardResetBtn) safeHardResetBtn.onclick = safeHardReset;


// ==================== AUTENTICACIÓN ====================

let currentUser = null;
let isAuthenticated = false;

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/check', {
            credentials: 'include'
        });
        const data = await res.json();
        isAuthenticated = data.authenticated;
        currentUser = data.user || null;
        updateAuthUI();
    } catch (e) {
        console.error('Error checking auth:', e);
        updateAuthUI();
    }
}

function updateAuthUI() {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userStatus = document.getElementById('userStatus');
    const adminElements = document.querySelectorAll('.admin-only');
    const devElements = document.querySelectorAll('.dev-only');
    
    if (isAuthenticated && currentUser) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        userStatus.textContent = `👤 ${currentUser.username} (${currentUser.role})`;
        userStatus.style.display = 'inline-block';
        
        // Guardar rol del usuario
        currentUserRole = currentUser.role;
        isDeveloperMode = (currentUser.role === 'developer');
        
        // Mostrar/ocultar elementos según rol
        adminElements.forEach(el => {
            el.classList.remove('admin-only-hidden');
        });
        
        // ✅ CORREGIDO: Usar style.display directamente
        devElements.forEach(el => {
            if (isDeveloperMode) {
                el.style.display = 'block';
            } else {
                el.style.display = 'none';
            }
        });
        
        // Mostrar badge de modo desarrollo si aplica
        updateDevModeBadge();

        // Mostrar tarjeta de simulación
        const simulationModeCard = document.getElementById('simulationModeCard');
        if (simulationModeCard) {
            if (isDeveloperMode) {
                simulationModeCard.style.display = 'block';
                    loadSimulationMode();
                    setupSimulationControls();
            } else {
                simulationModeCard.style.display = 'none';
            }
        }

        // Mostrar consola en tiempo real
        const devConsoleCard = document.getElementById('devConsoleCard');
        if (devConsoleCard) {
            if (isDeveloperMode) {
                devConsoleCard.style.display = 'block';
                startConsoleAutoRefresh();
                loadRealtimeLogs();
                setupConsoleControls();
            } else {
                devConsoleCard.style.display = 'none';
                stopConsoleAutoRefresh();
            }
        }
                
    } else {
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        userStatus.style.display = 'none';
        isDeveloperMode = false;
        currentUserRole = null;
        
        adminElements.forEach(el => {
            el.classList.add('admin-only-hidden');
        });
        
        // Ocultar elementos de desarrollador
        devElements.forEach(el => {
            el.style.display = 'none';
        });
        
        hideDevModeBadge();
        
        const activePanel = document.querySelector('.panel.active');
        if (activePanel && activePanel.classList.contains('admin-only')) {
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
            const publicPanel = document.getElementById('panel-tableroPublico');
            const publicLink = document.querySelector('[data-panel="tableroPublico"]');
            if (publicPanel) publicPanel.classList.add('active');
            if (publicLink) publicLink.classList.add('active');
        }
    }
}

function updateDevModeBadge() {
    let badge = document.getElementById('devModeBadge');
    if (!badge && isDeveloperMode) {
        badge = document.createElement('div');
        badge.id = 'devModeBadge';
        badge.style.cssText = 'position:fixed; top:90px; right:20px; background:#ff9800; color:#000; padding:4px 12px; border-radius:20px; font-size:0.7rem; font-weight:bold; z-index:9999;';
        badge.innerHTML = '🔧 MODO DESARROLLO';
        document.body.appendChild(badge);
    } else if (badge && !isDeveloperMode) {
        badge.remove();
    }
}

function hideDevModeBadge() {
    const badge = document.getElementById('devModeBadge');
    if (badge) badge.remove();
}

function openLoginModal() {
    document.getElementById('loginModal').style.display = 'flex';
}

function closeLoginModal() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
}

async function submitLogin() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    if (!username || !password) {
        showToast('Por favor ingresa usuario y contraseña', 'warning');
        return;
    }
    
    try {
        showLoader('Iniciando sesión...');
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        hideLoader();
        
        if (data.success) {
            isAuthenticated = true;
            currentUser = data.user;
            currentUserRole = data.user.role;
            isDeveloperMode = (currentUserRole === 'developer');
            sessionToken = data.session_token;
            
            localStorage.setItem('chronit_session_token', data.session_token);
            localStorage.setItem('chronit_user', JSON.stringify({
                username: currentUser.username,
                role: currentUser.role
            }));
            
            updateAuthUI();
            closeLoginModal();
            showToast(`✅ Bienvenido ${currentUser.username} (${currentUser.role})!`, 'success');
            
            // Recargar datos para aplicar modo desarrollo
            loadLiveData();
        } else {
            showToast(`❌ Error: ${data.message}`, 'error');
        }
    } catch (e) {
        hideLoader();
        console.error('Login error:', e);
        showToast('Error al iniciar sesión', 'error');
    }
}




async function submitLogout() {
    console.log("🔒 Cerrando sesión...");

    try {
        showLoader('Cerrando sesión...');

        // Usar la variable global sessionToken
        const token = sessionToken;
        console.log("Token a eliminar:", token);

        if (token) {
            // Enviar token al backend para eliminarlo de la BD
            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ session_token: token })
            });

            const result = await response.json();
            console.log("Respuesta del servidor:", result);
        } else {
            console.warn("No hay token para eliminar");
        }

        // Limpiar todo
        sessionToken = null;
        localStorage.removeItem('chronit_session_token');
        localStorage.removeItem('chronit_user');

        isAuthenticated = false;
        currentUser = null;
        updateAuthUI();

        hideLoader();
        showToast('✅ Sesión cerrada correctamente', 'success');

        // Recargar para limpiar estado
        setTimeout(() => location.reload(), 500);

    } catch (e) {
        hideLoader();
        console.error('Logout error:', e);
        showToast('Error al cerrar sesión', 'error');
    }
}




// Event listeners para login
document.getElementById('loginBtn').onclick = openLoginModal;
document.getElementById('cancelLoginBtn').onclick = closeLoginModal;
document.getElementById('submitLoginBtn').onclick = submitLogin;
document.getElementById('logoutBtn').onclick = submitLogout;

// Enter para login
document.getElementById('loginPassword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitLogin();
});

// Cerrar modal al hacer click fuera
document.getElementById('loginModal').onclick = (e) => {
    if (e.target === document.getElementById('loginModal')) {
        closeLoginModal();
    }
};
// Guardar estado de login antes de recargar
function saveLoginBeforeReload() {
    if (isAuthenticated && currentUser && sessionToken) {
        localStorage.setItem('chronit_session_token', sessionToken);
        localStorage.setItem('chronit_user', JSON.stringify({
            username: currentUser.username,
            role: currentUser.role
        }));
    }
}

// Restaurar login después de recargar
async function restoreLoginAfterReload() {
    const token = localStorage.getItem('chronit_session_token');
    if (token && !isAuthenticated) {
        try {
            const res = await fetch('/api/auth/verify-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ session_token: token })
            });
            const data = await res.json();
            if (data.success) {
                isAuthenticated = true;
                currentUser = data.user;
                sessionToken = token;
                updateAuthUI();
                console.log("✅ Sesión restaurada desde token persistente");
            } else {
                // Token inválido, limpiar
                localStorage.removeItem('chronit_session_token');
                localStorage.removeItem('chronit_user');
            }
        } catch (e) {
            console.error("Restauración falló:", e);
            localStorage.removeItem('chronit_session_token');
            localStorage.removeItem('chronit_user');
        }
        // No removemos los items aquí porque ya se usaron
    }
}

// ========== ABRIR RESPALDO EN SQLITE-WEB ==========

async function openBackupInSqlite(filename) {
    showLoader(`Preparando respaldo ${filename} para visualización...`);

    try {
        // 1. Llamar al endpoint para preparar el respaldo
        const res = await apiCall(`/api/backup/view/${filename}`, { method: 'GET' });

        if (res?.success) {
            // 2. Abrir una nueva pestaña con el panel de respaldos
            window.open('http://localhost:8883', '_blank');
            hideLoader();
            showToast(`✅ Respaldo "${filename}" cargado en la nueva pestaña.\n\nPuedes explorarlo en sqlite-web.`, 'success');
        } else {
            hideLoader();
            showToast(`❌ Error: ${res?.message || 'No se pudo preparar el respaldo'}`);
        }
    } catch (e) {
        hideLoader();
        console.error('Error abriendo respaldo:', e);
        showToast('❌ Error al conectar con el servidor', 'error');
    }
}
// ========== RESPALDOS DE PILOTOS Y TRANSPONDERS ==========

async function backupPilotos() {
    showLoader('Guardando respaldo de pilotos y transponders...');
    const res = await apiCall('/api/backup/pilotos', { method: 'POST' });
    hideLoader();
    if (res?.success) {
        showToast(`✅ ${res.message}`, 'success');
        await loadPilotosBackupsList();  // ✅ Recargar inmediatamente
        showToast('🔄', 'Lista de respaldos actualizada', 'info');
    } else {
        showToast('❌ Error al guardar respaldo', 'error');
    }
}

async function loadPilotosBackupsList() {
    const backups = await apiCall('/api/backup/pilotos/list');
    const container = document.getElementById('pilotosBackupsList');
    
    if (!container) return;
    
    if (!backups || backups.length === 0) {
        container.innerHTML = '<p class="muted-text">No hay respaldos de pilotos</p>';
        return;
    }
    
    container.innerHTML = backups.map(b => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px; border-bottom: 1px solid #2a3240;">
            <div>
                <strong>${b.filename}</strong><br>
                <small>📅 ${b.created} | 💾 ${b.size_kb} KB</small>
            </div>
            <div style="display: flex; gap: 5px;">
                <button class="btn btn-sm" onclick="restorePilotosBackup('${b.filename}')" style="background:#e5484d;">Restaurar</button>
                <button class="btn btn-sm" onclick="deletePilotosBackup('${b.filename}')" style="background:#ff9800;">🗑️ Eliminar</button>
            </div>
        </div>
    `).join('');
}

async function deletePilotosBackup(filename) {
    // Verificar si el usuario está autenticado como admin
    if (!isAuthenticated || currentUser?.role !== 'admin') {
        showToast('❌ No tienes permisos para eliminar respaldos de pilotos', 'error');
        return;
    }

    showModal('⚠️ Eliminar Respaldo de Pilotos',
        `¿Estás seguro de que deseas eliminar el respaldo de pilotos "${filename}"?\n\n⚠️ Esta acción no se puede deshacer.`,
        async () => {
            showLoader('Eliminando respaldo de pilotos...');

            try {
                const res = await apiCall(`/api/backup/pilotos/delete/${filename}`, { method: 'POST' });
                hideLoader();

                if (res?.success) {
                    showToast(`✅ ${res.message}`, 'success');
                    loadPilotosBackupsList();  // Recargar la lista
                } else {
                    showToast(`❌ Error: ${res?.message || 'No se pudo eliminar el respaldo'}`);
                }
            } catch (e) {
                hideLoader();
                console.error('Error eliminando respaldo:', e);
                showToast('❌ Error al conectar con el servidor', 'error');
            }
        }
    );
}

async function restorePilotosBackup(filename) {
    showModal('Restaurar Pilotos y Transponders',
        `¿Restaurar "${filename}"?\n\n⚠️ Esto reemplazará TODOS los pilotos y transponders actuales.\n\n✅ Se conservarán los datos de carrera (vueltas, sesiones) pero los pilotos volverán al estado guardado.`,
        async () => {
            showLoader('Restaurando pilotos y transponders...');
            const res = await apiCall(`/api/backup/pilotos/restore/${filename}`, { method: 'POST' });
            hideLoader();
            if (res?.success) {
                showToast(`✅ ${res.message}`, 'success');
                await loadLiveData();
            } else {
                showToast(`❌ Error: ${res?.message || 'No se pudo restaurar el respaldo'}`);
            }
        }
    );
}

document.getElementById('backupPilotosBtn').onclick = backupPilotos;
document.getElementById('restorePilotosBtn').onclick = () => loadPilotosBackupsList();


// ========== BOTÓN RESET DE VISTAS CON MODAL ==========
document.getElementById('resetVistasBtn').onclick = () => {
    // Mostrar modal de confirmación
    const modal = document.getElementById('resetBoardConfirmModal');
    modal.style.display = 'flex';
    
    // Configurar eventos del modal
    const cancelBtn = document.getElementById('resetBoardCancelBtn');
    const confirmBtn = document.getElementById('resetBoardConfirmActionBtn');
    
    // Función para cerrar modal
    const closeModal = () => {
        modal.style.display = 'none';
        cancelBtn.removeEventListener('click', closeModal);
        confirmBtn.removeEventListener('click', handleConfirm);
    };
    
    // Función para confirmar el reseteo
    const handleConfirm = async () => {
        closeModal();
        
        saveLoginBeforeReload();
        showLoader('Reseteando tablero...');
        
        // Limpiar variables locales
        frozenRaceData = null;
        lastRaceDataSnapshot = null;
        winnerModalShown = false;
        autoFinishInProgress = false;
        raceTimerState = { seconds: 0, status: 'pending', lastSyncMs: Date.now() };
        
        // ✅ CORREGIDO: Usar clear-all en lugar de reset
        const res = await apiCall('/api/race/clear-all', { method: 'POST' });
        
        hideLoader();
        
        if (res?.success) {
            showToast('✅', 'Tablero reseteado correctamente', 'success');
            await loadLiveData();
        } else {
            showToast('❌', res?.error || 'No se pudo resetear', 'error');
        }
    };
    
    cancelBtn.addEventListener('click', closeModal);
    confirmBtn.addEventListener('click', handleConfirm);
    
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
    
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
};
// ========== SPLASH DE INICIO DE CARRERA ==========
async function showRaceStartSplash(raceName, lapsLimit) {
    console.log("🎬 showRaceStartSplash llamada", { raceName, lapsLimit });

    const splash = document.getElementById('raceStartSplash');
    if (!splash) {
        console.error("❌ No se encontró el elemento #raceStartSplash");
        return false;
    }

    // Actualizar contenido
    const nameEl = document.getElementById('splashRaceName');
    const lapsEl = document.getElementById('splashLapsLimit');
    if (nameEl) nameEl.innerText = raceName;
    if (lapsEl) lapsEl.innerText = `Vueltas: ${lapsLimit}`;

    // Mostrar splash
    splash.style.display = 'flex';
    console.log("✅ Splash visible");

    // Esperar 2 segundos
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Ocultar splash
    splash.style.display = 'none';
    console.log("✅ Splash ocultado");

    return true;
}

// ==================== CONFIGURACIÓN DE CRONOMETRAJE ====================

function toggleMinLapTimeVisibility() {
    const timeSource = document.getElementById('timeSourceSelect').value;
    const minLapTimeRow = document.getElementById('minLapTimeRow');
    const timeSourceHint = document.getElementById('timeSourceHint');

    if (timeSource === 'server') {
        minLapTimeRow.style.display = 'block';
        timeSourceHint.innerHTML = '🖥️ Servidor: filtra señales fantasmas con tiempo mínimo por vuelta';
        timeSourceHint.style.color = '#64e6a3';
    } else {
        minLapTimeRow.style.display = 'none';
        timeSourceHint.innerHTML = '🔧 Decoder: tiempo preciso del hardware (sin filtro anti-fantasmas)';
        timeSourceHint.style.color = '#f4c06b';
    }
}

async function loadTimingConfig() {
    const res = await apiCall('/api/config/timing');
    if (res) {
        document.getElementById('timeSourceSelect').value = res.time_source || 'server';
        document.getElementById('minLapTimeSlider').value = res.min_valid_lap_time || 5.0;
        document.getElementById('minLapTimeValue').value = res.min_valid_lap_time || 5.0;
        toggleMinLapTimeVisibility();  // Mostrar/ocultar según valor cargado
    }
}

// Sincronizar slider y input
if (document.getElementById('minLapTimeSlider')) {
    document.getElementById('minLapTimeSlider').oninput = function () {
        document.getElementById('minLapTimeValue').value = this.value;
    };
    document.getElementById('minLapTimeValue').onchange = function () {
        document.getElementById('minLapTimeSlider').value = this.value;
    };
}

// Mostrar/ocultar cuando cambia la selección
if (document.getElementById('timeSourceSelect')) {
    document.getElementById('timeSourceSelect').onchange = function () {
        toggleMinLapTimeVisibility();
    };
}

// Guardar configuración
if (document.getElementById('saveTimingConfigBtn')) {
    document.getElementById('saveTimingConfigBtn').onclick = async () => {
        const config = {
            time_source: document.getElementById('timeSourceSelect').value,
            min_valid_lap_time: parseFloat(document.getElementById('minLapTimeSlider').value)
        };

        const statusSpan = document.getElementById('timingConfigStatus');
        statusSpan.innerText = '⏳ Guardando...';
        statusSpan.style.color = '#ffaa00';

        const res = await apiCall('/api/config/timing', {
            method: 'POST',
            body: JSON.stringify(config)
        });

        if (res?.success) {
            statusSpan.innerText = '✅ Guardado';
            statusSpan.style.color = '#00c853';
            setTimeout(() => {
                statusSpan.innerText = '';
            }, 3000);
            showToast('✅ Configuración de cronometraje guardada. Reinicia la carrera para aplicar cambios.');
        } else {
            statusSpan.innerText = '❌ Error';
            statusSpan.style.color = '#e5484d';
            showToast('❌ Error', 'No se pudo guardar la configuración', 'error');
        }
    };
}

document.getElementById('timeSourceSelect').addEventListener('change', function () {
    const hint = document.getElementById('timeSourceHint');
    if (this.value === 'server') {
        hint.innerHTML = "<strong>Servidor:</strong> Filtra señales fantasmas usando el reloj de la laptop. Ideal para precisión extrema.";
    } else {
        hint.innerHTML = "<strong>Decoder:</strong> Usa el tiempo real del equipo físico. Útil para diagnósticos de hardware.";
    }
});



// ==================== BOTÓN DE IP DE CONEXIÓN ====================

let currentIp = null;

async function cargarIpConexion() {
    console.log("📡 Cargando IP de conexión...");

    try {
        const res = await apiCall('/api/system/ip');
        console.log("Respuesta IP:", res);

        if (res?.success && res.ips && res.ips.length > 0) {
            // Guardar la PRIMERA IP como currentIp
            currentIp = res.ips[0];
            console.log("✅ IP guardada:", currentIp);

            const container = document.getElementById('ipListContainer');
            container.innerHTML = res.ips.map(ip => `
                    <div style="background: #0d1218; border-radius: 8px; padding: 10px; margin-bottom: 8px;">
                        <div style="font-family: monospace; font-size: 1rem; color: #00c853; word-break: break-all;">
                            http://${ip}:5000
                        </div>
                        <div style="font-size: 0.7rem; color: #666; margin-top: 4px;">
                            Escanea el código QR o ingresa esta IP en tu celular
                        </div>
                    </div>
                `).join('');

            generarQRLocal(`http://${currentIp}:5000`);
        } else {
            mostrarErrorIp();
            currentIp = null;
        }
    } catch (e) {
        console.error('Error al obtener IP:', e);
        mostrarErrorIp();
        currentIp = null;
    }
}


function mostrarErrorIp() {
    document.getElementById('ipListContainer').innerHTML = `
            <div style="background: #0d1218; border-radius: 8px; padding: 10px;">
                <span style="color: #e5484d;">❌ No se pudo detectar la IP automáticamente</span>
                <div style="font-size: 0.7rem; margin-top: 8px;">
                    Verifica tu conexión WiFi<br>
                    IP típica: 192.168.x.x o 10.x.x.x
                </div>
            </div>
        `;
    document.getElementById('qrCodePlaceholder').innerHTML = '<span style="color: #888;">No disponible</span>';
}

function generarQRLocal(url) {
    const qrContainer = document.getElementById('qrCodePlaceholder');
    const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(url)}&size=120`;

    qrContainer.innerHTML = `
            <img src="${qrUrl}" width="120" height="120" alt="QR Code" style="margin: 0 auto;">
            <div style="font-family: monospace; font-size: 0.7rem; margin-top: 8px; word-break: break-all; color: #333;">
                ${url}
            </div>
        `;
}

function copiarIp() {
    console.log("📋 Botón copiar presionado, currentIp:", currentIp);

    if (currentIp) {
        const url = `http://${currentIp}:5000`;
        navigator.clipboard.writeText(url).then(() => {
            showToast(`✅ Dirección copiada: ${url}`, 'success');
        }).catch(() => {
            // Fallback para navegadores sin clipboard API
            const textarea = document.createElement('textarea');
            textarea.value = url;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showToast(`✅ Dirección copiada: ${url}`, 'success');
        });
    } else {
        showToast('❌ No hay IP para copiar. Haz clic en "Refrescar" primero.', 'error');
    }
}

function refrescarIp() {
    console.log("🔄 Refrescando IP...");
    cargarIpConexion();
    showToast('🔄 IP refrescada');
}

if (document.getElementById('copyIpBtn')) {
    document.getElementById('copyIpBtn').onclick = copiarIp;
}
if (document.getElementById('refreshIpBtn')) {
    document.getElementById('refreshIpBtn').onclick = refrescarIp;
}


// ==================== Mostrar Toast ====================


function showToast(title, message, type = 'info') {
    // type puede ser: 'success', 'error', 'warning', 'info'
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.backgroundColor = type === 'success' ? '#1e7e34' : (type === 'error' ? '#dc3545' : (type === 'warning' ? '#ffc107' : '#17a2b8'));
    toast.style.color = 'white';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '10001';
    toast.style.fontSize = '0.9rem';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    toast.innerText = `${title}: ${message}`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

function renderLiveLeaderboardPublicStyle(leaderboard, session, speedsMap = {}, timesMap = {}) {
    const container = document.getElementById('liveLeaderboardPublicStyle');

    if (!container) {
        console.warn("⚠️ Elemento liveLeaderboardPublicStyle no encontrado");
        return;
    }

    const driverColors = [
        '#ff9800', '#03a9f4', '#9c27b0', '#00bcd4', '#4caf50',
        '#ffeb3b', '#2196f3', '#ff5722', '#673ab7', '#e91e63',
        '#00e5ff', '#76ff03', '#ffc400', '#ff7043', '#ab47bc',
        '#00acc1', '#c0ca33', '#ec407a', '#42a5f5', '#26a69a',
    ];

    if (!leaderboard || !leaderboard.length) {
        container.innerHTML = '<div style="text-align:center; padding:2rem;">Sin pilotos inscritos</div>';
        return;
    }

    const finishedOrder = leaderboard
        .filter(d => d.is_finished && d.total_laps >= (session.laps_limit || 0))
        .sort((a, b) => (a.total_time || 0) - (b.total_time || 0));

        container.innerHTML = leaderboard.map((driver, idx) => {
        const color = driverColors[idx % driverColors.length];
        const best = driver.best_lap != null ? formatRaceClock(driver.best_lap) : '--';
        const totalTime = driver.total_time != null ? formatRaceClock(driver.total_time) : '--';
        const individualTime = timesMap[driver.driver_id] || '--';
        const kartLabel = driver.kart_id ? driver.kart_id : driver.transponder_id || '--';
        
        const speed = speedsMap[driver.driver_id];
        const speedFormatted = (speed && speed > 0 && speed < 400) ? `${Math.round(speed)} km/h` : '--';
        
        let cupIcon = '';
        if (driver.is_finished && driver.total_laps >= (session.laps_limit || 0)) {
            const posInFinished = finishedOrder.findIndex(d => d.driver_id === driver.driver_id);
            if (posInFinished === 0) cupIcon = ' 🏆';
            else if (posInFinished === 1) cupIcon = ' 🥈';
            else if (posInFinished === 2) cupIcon = ' 🥉';
        }
        
        return `
        <div class="k-row ${idx === 0 ? 'row-first' : ''}">
            <div class="k-col-pos">${driver.position || (idx + 1)}</div>
            <div class="k-col-name">
                <span class="driver-name">${driver.full_name || driver.name}${cupIcon}</span>
                <div class="progress-line ${idx === 0 ? 'line-gold' : 'line-blue'}" style="background: linear-gradient(90deg, ${color}, transparent);"></div>
            </div>
            <div class="k-col-vueltas">${driver.total_laps || 0}/${session.laps_limit || 0}</div>
            <div class="k-col-mejor"><span class="time-box box-gold">${best}</span></div>
            <div class="k-col-tiempo"><span class="time-box box-black">${totalTime}</span></div>
            <div class="k-col-tiempo-individual"><span class="time-box box-black">${individualTime}</span></div>
            <div class="k-col-velocidad"><span class="time-box box-black">${speedFormatted}</span></div>
            <div class="k-col-kart"><span class="kart-circle" style="background-color: ${color};">${kartLabel}</span></div>
        </div>
    `;
    }).join('');
}

function updateLiveHeader(session) {
    if (!session) return;

    const raceNameDisplay = document.getElementById('liveRaceNameDisplay');
    if (raceNameDisplay) raceNameDisplay.innerText = session.circuit_name || 'Sin carrera';

    const raceModeDisplay = document.getElementById('liveRaceModeDisplay');
    if (raceModeDisplay) raceModeDisplay.innerText = `Modo: ${raceModeLabel(session.race_mode)}`;

    const raceDescDisplay = document.getElementById('liveRaceDescriptionDisplay');
    if (raceDescDisplay) raceDescDisplay.innerText = raceModeDescription(session.race_mode);

    const statusBadge = document.getElementById('liveRaceStatusBadge');
    if (statusBadge) {
        const status = session.status || 'pending';
        statusBadge.classList.remove('status-pending', 'status-active', 'status-paused', 'status-completed');

        switch (status) {
            case 'active':
                statusBadge.innerText = '🏁 EN CURSO';
                statusBadge.classList.add('status-active');
                break;
            case 'paused':
                statusBadge.innerText = '⏸️ PAUSADA';
                statusBadge.classList.add('status-paused');
                break;
            case 'completed':
                statusBadge.innerText = '🏆 FINALIZADA';
                statusBadge.classList.add('status-completed');
                break;
            default:
                statusBadge.innerText = '⏳ PENDIENTE';
                statusBadge.classList.add('status-pending');
        }
    }

    // Actualizar cronómetro grande
    const liveTotalTime = document.getElementById('liveTotalTime');
    if (liveTotalTime) {
        let seconds = session.race_elapsed_seconds || 0;
        if (session.status === 'active') {
            seconds += (Date.now() - raceTimerState.lastSyncMs) / 1000;
        }
        liveTotalTime.innerText = formatRaceClock(seconds);
    }
}

// ==================== MODAL MINIMALISTA PARA EDITAR TRANSPONDER ====================
let pendingMinimalTransponderId = null;
let pendingMinimalCallback = null;

function showEditTransponderModal(transponderId, onConfirm) {
    pendingMinimalTransponderId = transponderId;
    pendingMinimalCallback = onConfirm;

    const modal = document.getElementById('editTransponderMinimalModal');
    const input = document.getElementById('editTransponderMinimalInput');
    const msg = document.getElementById('editTransponderMinimalMsg');

    // Personalizar mensaje
    msg.innerText = `Ingrese el nuevo ID para el respondedor ${transponderId}:`;
    input.value = transponderId;

    // Mostrar modal
    modal.style.display = 'flex';

    // Enfocar input
    setTimeout(() => input.focus(), 100);

    // Seleccionar todo el texto
    input.select();
}


function setupMinimalModalEvents() {
    const modal = document.getElementById('editTransponderMinimalModal');
    const input = document.getElementById('editTransponderMinimalInput');
    const cancelBtn = document.getElementById('editTransponderMinimalCancel');
    const confirmBtn = document.getElementById('editTransponderMinimalConfirm');

    if (!modal) return;

    const closeModal = () => {
        modal.style.display = 'none';
        input.value = '';
        pendingMinimalTransponderId = null;
        pendingMinimalCallback = null;
    };

    cancelBtn.onclick = closeModal;

    confirmBtn.onclick = async () => {
        const newId = parseInt(input.value);

        if (isNaN(newId)) {
            showToast('❌', 'El ID debe ser un número válido.', 'error');
            return;
        }

        if (pendingMinimalCallback) {
            const success = await pendingMinimalCallback(newId);
            if (success !== false) {
                closeModal();
            }
        } else {
            closeModal();
        }
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmBtn.click();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });

    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };
}

window.editTransponderIdMinimal = (id) => {
    showEditTransponderModal(id, async (newId) => {
        const numId = newId;
        const oldId = id;

        if (numId === oldId) {
            showToast('ℹ️', 'El ID no cambió', 'info');
            return true;
        }

        // Verificar que el nuevo ID no exista
        const allTransponders = await apiCall('/api/transponders/all');
        if (allTransponders && allTransponders.some(t => t.id === numId)) {
            showToast('❌', `El ID ${numId} ya existe`, 'error');
            return false;
        }

        showLoader(`Cambiando ID de ${oldId} a ${numId}...`);
        const res = await apiCall(`/api/transponders/${oldId}`, {
            method: 'PUT',
            body: JSON.stringify({ new_id: numId })
        });
        hideLoader();

        if (res?.success) {
            showToast('✅', `Transponder actualizado: ${oldId} → ${numId}`, 'success');
            loadTransponders();
            loadTransponderHealth();
            return true;
        } else {
            showToast('❌', res?.error || 'Error al actualizar', 'error');
            return false;
        }
    });
};


setupMinimalModalEvents();

let pendingDriverData = null;

function showEditDriverModal(driverId, currentName, currentLastname, currentTransponder, onConfirm) {
    pendingDriverData = { driverId, onConfirm };

    const modal = document.getElementById('editDriverMinimalModal');
    const nameInput = document.getElementById('editDriverNameInput');
    const lastnameInput = document.getElementById('editDriverLastnameInput');
    const transponderInput = document.getElementById('editDriverTransponderInput');

    // Llenar con datos actuales
    nameInput.value = currentName;
    lastnameInput.value = currentLastname || '';
    transponderInput.value = currentTransponder;

    // Mostrar modal
    modal.style.display = 'flex';

    // Enfocar el campo nombre
    setTimeout(() => nameInput.focus(), 100);
    nameInput.select();
}

// Configurar eventos del modal de piloto
function setupDriverModalEvents() {
    const modal = document.getElementById('editDriverMinimalModal');
    const nameInput = document.getElementById('editDriverNameInput');
    const lastnameInput = document.getElementById('editDriverLastnameInput');
    const transponderInput = document.getElementById('editDriverTransponderInput');
    const cancelBtn = document.getElementById('editDriverMinimalCancel');
    const confirmBtn = document.getElementById('editDriverMinimalConfirm');

    if (!modal) return;

    const closeModal = () => {
        modal.style.display = 'none';
        nameInput.value = '';
        lastnameInput.value = '';
        transponderInput.value = '';
        pendingDriverData = null;
    };

    cancelBtn.onclick = closeModal;

    confirmBtn.onclick = async () => {
        const newName = nameInput.value.trim();
        const newLastname = lastnameInput.value.trim();
        const newTransponder = parseInt(transponderInput.value);

        if (!newName) {
            showToast('❌', 'El nombre es obligatorio', 'error');
            return;
        }

        if (isNaN(newTransponder)) {
            showToast('❌', 'El ID del transponder debe ser un número', 'error');
            return;
        }

        if (pendingDriverData && pendingDriverData.onConfirm) {
            const success = await pendingDriverData.onConfirm(newName, newLastname, newTransponder);
            if (success !== false) {
                closeModal();
            }
        } else {
            closeModal();
        }
    };

    // Enter confirma
    const inputs = [nameInput, lastnameInput, transponderInput];
    inputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmBtn.click();
            }
        });
    });

    // Escape cancela
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });

    // Clic fuera cierra
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };
}

// NUEVA FUNCIÓN: Editar piloto con modal minimalista
window.editDriverMinimal = (id, name, lastname, transponder) => {
    showEditDriverModal(id, name, lastname, transponder, async (newName, newLastname, newTransponder) => {
        showLoader('Actualizando piloto...');

        const res = await apiCall(`/api/drivers/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: newName,
                lastname: newLastname,
                transponder_id: newTransponder
            })
        });

        hideLoader();

        if (res?.success) {
            showToast('✅', 'Piloto actualizado correctamente', 'success');
            loadDrivers();
            loadTransponders();
            return true;
        } else {
            showToast('❌', res?.error || 'Error al actualizar piloto', 'error');
            return false;
        }
    });
};

// Inicializar eventos del modal de piloto
setupDriverModalEvents();

// Sincronizar slider y input
if (document.getElementById('trackLengthSlider')) {
    document.getElementById('trackLengthSlider').oninput = function () {
        document.getElementById('trackLengthValue').value = this.value;
    };
    document.getElementById('trackLengthValue').onchange = function () {
        document.getElementById('trackLengthSlider').value = this.value;
    };
}

// Guardar configuración de pista
if (document.getElementById('saveTrackConfigBtn')) {
    document.getElementById('saveTrackConfigBtn').onclick = async () => {
        const trackLength = parseFloat(document.getElementById('trackLengthSlider').value);

        const statusSpan = document.getElementById('trackConfigStatus');
        statusSpan.innerText = '⏳ Guardando...';
        statusSpan.style.color = '#ffaa00';

        const res = await apiCall('/api/circuit/config', {
            method: 'POST',
            body: JSON.stringify({ track_length_km: trackLength })
        });

        if (res?.success) {
            statusSpan.innerText = '✅ Guardado';
            statusSpan.style.color = '#00c853';
            setTimeout(() => {
                statusSpan.innerText = '';
            }, 3000);
            showToast('✅', `Largo de pista: ${trackLength} km`, 'success');
        } else {
            statusSpan.innerText = '❌ Error';
            statusSpan.style.color = '#e5484d';
            showToast('❌', 'Error al guardar', 'error');
        }
    };
}


async function loadTrackConfig() {
    const res = await apiCall('/api/circuit/config');
    if (res) {
        const trackLength = res.track_length_km || 0;
        const trackType = res.track_type || 'karting';

        document.getElementById('trackLengthSlider').value = trackLength;
        document.getElementById('trackLengthValue').value = trackLength;
        document.getElementById('trackTypeSelect').value = trackType;

        // Actualizar hint según tipo seleccionado
        updateTrackLengthHint(trackType);
    }
}

function updateTrackLengthHint(trackType) {
    const hint = document.getElementById('trackLengthHint');
    const hints = {
        'karting': '🏎️ Karting: 0.8 - 1.5 km',
        'motocross': '🏍️ Motocross: 1.5 - 3 km',
        'moto_rally': '🏁 Moto Rally: 3 - 10 km',
        'autodromo': '🏎️ Autódromo: 4 - 7 km',
        'enduro': '🌲 Enduro: 10 - 50 km',
        'circuito_callejero': '🏙️ Circuito Callejero: 5 - 7 km',
        'custom': '📏 Ingresa el largo personalizado'
    };
    hint.innerText = hints[trackType] || hints['karting'];
}

// Evento cuando cambia el tipo de pista
if (document.getElementById('trackTypeSelect')) {
    document.getElementById('trackTypeSelect').onchange = function () {
        updateTrackLengthHint(this.value);

        // Si es un tipo predefinido, sugerir un largo típico
        const suggestions = {
            'karting': 1.2,
            'motocross': 2.2,
            'moto_rally': 6.5,
            'autodromo': 5.5,
            'enduro': 15,
            'circuito_callejero': 6.0
        };

        if (suggestions[this.value]) {
            document.getElementById('trackLengthSlider').value = suggestions[this.value];
            document.getElementById('trackLengthValue').value = suggestions[this.value];
        }
    };
}

// Guardar configuración
if (document.getElementById('saveTrackConfigBtn')) {
    document.getElementById('saveTrackConfigBtn').onclick = async () => {
        const trackLength = parseFloat(document.getElementById('trackLengthSlider').value);
        const trackType = document.getElementById('trackTypeSelect').value;

        const statusSpan = document.getElementById('trackConfigStatus');
        statusSpan.innerText = '⏳ Guardando...';
        statusSpan.style.color = '#ffaa00';

        const res = await apiCall('/api/circuit/config', {
            method: 'POST',
            body: JSON.stringify({
                track_length_km: trackLength,
                track_type: trackType
            })
        });

        if (res?.success) {
            statusSpan.innerText = '✅ Guardado';
            statusSpan.style.color = '#00c853';
            setTimeout(() => {
                statusSpan.innerText = '';
            }, 3000);
            showToast('✅', `Configuración guardada (${trackType} - ${trackLength} km)`, 'success');
        } else {
            statusSpan.innerText = '❌ Error';
            statusSpan.style.color = '#e5484d';
            showToast('❌', 'Error al guardar', 'error');
        }
    };
}
// ==================== BOTÓN REFRESCAR PILOTOS ====================
const refreshAllPilotsBtn = document.getElementById('refreshAllPilotsBtn');
if (refreshAllPilotsBtn) {
    refreshAllPilotsBtn.onclick = async () => {
        console.log("🔄 Refrescando listas de pilotos...");
        showLoader('Actualizando listas de pilotos...');
        
        try {
            // Recargar ambas listas
            await loadDrivers();
            
            // Pequeña pausa para asegurar que se actualizó
            setTimeout(() => {
                hideLoader();
                showToast('✅', 'Listas actualizadas correctamente', 'success');
            }, 500);
        } catch (error) {
            hideLoader();
            console.error("Error refrescando:", error);
            showToast('❌', 'Error al actualizar las listas', 'error');
        }
    };
}

const refreshAllPilotsBtn2 = document.getElementById('refreshAllPilotsBtn2');
if (refreshAllPilotsBtn2) {
    refreshAllPilotsBtn2.onclick = async () => {
        console.log("🔄 Refrescando listas de pilotos...");
        showLoader('Actualizando listas de pilotos...');
        
        try {
            // Recargar ambas listas
            await loadDrivers();
            
            // Pequeña pausa para asegurar que se actualizó
            setTimeout(() => {
                hideLoader();
                showToast('✅', 'Listas actualizadas correctamente', 'success');
            }, 500);
        } catch (error) {
            hideLoader();
            console.error("Error refrescando:", error);
            showToast('❌', 'Error al actualizar las listas', 'error');
        }
    };
}

const refreshPilotosBackupsBtn = document.getElementById('refreshPilotosBackupsBtn');
if (refreshPilotosBackupsBtn) {
    refreshPilotosBackupsBtn.onclick = () => {
        loadPilotosBackupsList();
        showToast('🔄', 'Lista de respaldos actualizada', 'info');
    };
}


function loadSimulationMode() {
    // Cargar desde localStorage
    const savedMode = localStorage.getItem('chronit_simulation_mode');
    isSimulationMode = (savedMode === 'true');
    
    const toggle = document.getElementById('simulationModeToggle');
    const warning = document.getElementById('simulationWarning');
    const statusBadge = document.getElementById('simulationModeStatus');
    const generateBtn = document.getElementById('generateTestLapsBtn');
    
    if (toggle) {
        toggle.checked = isSimulationMode;
        
        // Actualizar UI según estado
        if (statusBadge) {
            statusBadge.innerText = isSimulationMode ? '🎮 SIMULACIÓN ACTIVA' : '🔴 MODO REAL';
            statusBadge.style.background = isSimulationMode ? '#ff9800' : '#e5484d';
            statusBadge.style.color = 'white';
        }
        
        if (warning) {
            warning.style.display = isSimulationMode ? 'block' : 'none';
        }
        
        if (generateBtn) {
            generateBtn.style.display = isSimulationMode ? 'inline-flex' : 'none';
        }
    }
    
    // Aplicar modo simulación a main.py
    applySimulationMode();
}

function applySimulationMode() {
    // Enviar comando a main.py para activar/desactivar simulación
    apiCall('/api/simulation/mode', {
        method: 'POST',
        body: JSON.stringify({ enabled: isSimulationMode })
    });
}

function setupSimulationControls() {
    const toggle = document.getElementById('simulationModeToggle');
    const generateBtn = document.getElementById('generateTestLapsBtn');
    
    if (toggle) {
        toggle.onchange = async () => {
            isSimulationMode = toggle.checked;
            
            // Guardar en localStorage
            localStorage.setItem('chronit_simulation_mode', isSimulationMode);
            await applySimulationMode();
            
            // Actualizar UI
            const statusBadge = document.getElementById('simulationModeStatus');
            const warning = document.getElementById('simulationWarning');
            const generateBtn = document.getElementById('generateTestLapsBtn');
            
            if (statusBadge) {
                statusBadge.innerText = isSimulationMode ? '🎮 SIMULACIÓN ACTIVA' : '🔴 MODO REAL';
                statusBadge.style.background = isSimulationMode ? '#ff9800' : '#e5484d';
            }
            
            if (warning) {
                warning.style.display = isSimulationMode ? 'block' : 'none';
            }
            
            if (generateBtn) {
                generateBtn.style.display = isSimulationMode ? 'inline-flex' : 'none';
            }
            
            // Aplicar modo
            showLoader(isSimulationMode ? 'Activando modo simulación...' : 'Desactivando modo simulación...');
            await applySimulationMode();
            hideLoader();
            
            showToast(isSimulationMode ? '🎮' : '🔴', 
                isSimulationMode ? 'Modo simulación activado. Las vueltas se generan automáticamente.' : 'Modo real activado. Se requiere decoder físico.', 
                isSimulationMode ? 'warning' : 'info');
        };
    }
    
    // Botón para generar vueltas de prueba manualmente
    if (generateBtn) {
        generateBtn.onclick = async () => {
            if (!isSimulationMode) {
                showToast('⚠️', 'Activa el modo simulación primero', 'warning');
                return;
            }
            
            showLoader('Generando vueltas de prueba...');
            const res = await apiCall('/api/simulation/generate-lap', { method: 'POST' });
            hideLoader();
            
            if (res?.success) {
                showToast('✅', 'Vuelta de prueba generada', 'success');
                await loadLiveData();
            } else {
                showToast('❌', res?.error || 'Error al generar vuelta', 'error');
            }
        };
    }
}
// ==================== CONSOLA EN TIEMPO REAL ====================
let consoleInterval = null;
async function loadRealtimeLogs() {
    if (!isDeveloperMode) {
        console.log("🔴 Modo desarrollador no activo");
        return;
    }
    
    try {
        // Usar fetch directamente en lugar de apiCall para más control
        const token = sessionToken || localStorage.getItem('chronit_session_token');
        const headers = {};
        if (token) {
            headers['X-Session-Token'] = token;
        }
        
        const response = await fetch('/api/logs?lines=200', { headers: headers });
        const data = await response.json();
        
        console.log("📡 Logs recibidos:", data);
        
        const container = document.getElementById('consoleLogsContainer');
        if (!container) {
            console.error("❌ No se encontró el contenedor de logs");
            return;
        }
        
        if (!data || !data.logs || data.logs.length === 0) {
            container.innerHTML = '<div style="color: #888; text-align: center; padding: 2rem;">No hay logs disponibles. Inicia una carrera para ver eventos.</div>';
            return;
        }
        
        // Función para colorear según contenido
        const getLogColor = (logText) => {
            if (logText.includes('CARRERA INICIADA')) return '#63d297';
            if (logText.includes('CARRERA FINALIZADA')) return '#ffd700';
            if (logText.includes('PAUSADA')) return '#f4c06b';
            if (logText.includes('REANUDADA')) return '#00c853';
            if (logText.includes('DETECCIÓN')) return '#00aaff';
            if (logText.includes('ERROR') || logText.includes('❌')) return '#ef7a86';
            if (logText.includes('⚠️')) return '#ff9800';
            return '#00ff00';
        };
        
        // Renderizar logs
        container.innerHTML = data.logs.map(log => {
            const logText = log.text || log;
            return `<div style="color: ${getLogColor(logText)}; margin-bottom: 0.3rem; border-bottom: 1px solid #1a1a1a; padding: 0.2rem 0; font-family: monospace; font-size: 0.7rem; word-break: break-all;">
                ${escapeHtml(logText)}
            </div>`;
        }).join('');
        
        // Auto-scroll al final
        container.scrollTop = container.scrollHeight;
        
        console.log("✅ Logs renderizados:", data.logs.length);
        
    } catch (e) {
        console.error("❌ Error cargando logs:", e);
        const container = document.getElementById('consoleLogsContainer');
        if (container) {
            container.innerHTML = '<div style="color: #ef7a86; text-align: center; padding: 2rem;">Error cargando logs: ' + e.message + '</div>';
        }
    }
}

function renderConsoleLogs(logs) {
    const container = document.getElementById('consoleLogsContainer');
    if (!container) return;
    
    if (!logs || logs.length === 0) {
        container.innerHTML = '<div style="color: #888; text-align: center; padding: 2rem;">No hay logs disponibles. Inicia una carrera para ver eventos.</div>';
        return;
    }
    
    // Verificar la estructura de los logs
    console.log("📋 Logs recibidos para renderizar:", logs);
    
    const getLogColor = (logText) => {
        if (logText.includes('CARRERA INICIADA')) return '#63d297';
        if (logText.includes('CARRERA FINALIZADA')) return '#ffd700';
        if (logText.includes('PAUSADA')) return '#f4c06b';
        if (logText.includes('REANUDADA')) return '#00c853';
        if (logText.includes('DETECCIÓN')) return '#00aaff';
        if (logText.includes('ERROR') || logText.includes('❌')) return '#ef7a86';
        if (logText.includes('⚠️')) return '#ff9800';
        return '#00ff00';
    };
    
    // Extraer el texto de cada log (puede ser string o objeto con propiedad 'text')
    const logTexts = logs.map(log => {
        if (typeof log === 'string') return log;
        if (log.text) return log.text;
        return JSON.stringify(log);
    });
    
    container.innerHTML = logTexts.map(logText => `
        <div style="color: ${getLogColor(logText)}; margin-bottom: 0.3rem; border-bottom: 1px solid #1a1a1a; padding: 0.2rem 0; font-family: monospace; font-size: 0.7rem; word-break: break-all;">
            ${escapeHtml(logText)}
        </div>
    `).join('');
    
    container.scrollTop = container.scrollHeight;
}

function startConsoleAutoRefresh() {
    if (consoleInterval) clearInterval(consoleInterval);
    if (!isDeveloperMode) return;
    loadRealtimeLogs();
    consoleInterval = setInterval(() => {
        const systemPanel = document.getElementById('panel-system');
        if (systemPanel && systemPanel.classList.contains('active') && isDeveloperMode) {
            loadRealtimeLogs();
        }
    }, 2000);
}

function stopConsoleAutoRefresh() {
    if (consoleInterval) {
        clearInterval(consoleInterval);
        consoleInterval = null;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


// ==================== BOTONES DE LA CONSOLA ====================

// Limpiar logs
async function clearConsoleLogs() {
    try {
        const token = sessionToken || localStorage.getItem('chronit_session_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['X-Session-Token'] = token;
        }
        
        const response = await fetch('/api/logs/clear', { 
            method: 'POST',
            headers: headers
        });
        const data = await response.json();
        
        if (data.success) {
            showToast('✅', 'Logs limpiados correctamente', 'success');
            loadRealtimeLogs(); // Recargar logs después de limpiar
        } else {
            showToast('❌', data.error || 'Error al limpiar logs', 'error');
        }
    } catch (e) {
        console.error("Error limpiando logs:", e);
        showToast('❌', 'Error al limpiar logs', 'error');
    }
}

// Exportar logs
function exportConsoleLogs() {
    const container = document.getElementById('consoleLogsContainer');
    if (!container) return;
    
    // Obtener todos los textos de los logs
    const logElements = container.querySelectorAll('div');
    const logsText = Array.from(logElements).map(el => el.innerText).join('\n');
    
    if (!logsText || logsText === 'No hay logs disponibles. Inicia una carrera para ver eventos.') {
        showToast('⚠️', 'No hay logs para exportar', 'warning');
        return;
    }
    
    // Crear archivo para descargar
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chronit_logs_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('✅', 'Logs exportados correctamente', 'success');
}

// Refrescar logs manualmente
function refreshConsoleLogs() {
    loadRealtimeLogs();
    showToast('🔄', 'Logs actualizados', 'info');
}

function setupConsoleControls() {
    const clearBtn = document.getElementById('clearLogsBtn');
    const exportBtn = document.getElementById('exportLogsBtn');
    const refreshBtn = document.getElementById('refreshLogsBtn');
    
    if (clearBtn) {
        clearBtn.onclick = clearConsoleLogs;
    }
    
    if (exportBtn) {
        exportBtn.onclick = exportConsoleLogs;
    }
    
    if (refreshBtn) {
        refreshBtn.onclick = refreshConsoleLogs;
    }
}


// Verificar autenticación al cargar la página
checkAuth();
restoreLoginAfterReload();
