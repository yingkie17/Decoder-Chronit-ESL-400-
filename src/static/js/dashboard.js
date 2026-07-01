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
let speedCache = {};
let lapDetailsCache = {};
let CACHE_DURATION = 5000;
let lastRefreshTime = 0;
let pendingRefresh = false;
let modoLogCounter = 0;
let allRaceHistory = [];
let currentHistoryFilter = '';
let globalRaceData = null;
let globalSessionId = null;
let currentPilotFilter = null;
let pilotHistoryCurrentPage = 1;
let pilotHistoryPageSize = 12;
let selectedPilotId = null;
let allPilotsHistory = [];
let pilotHistoryData = [];
let historyCurrentPage = 1;
let historyPageSize = 10;
let historyTotalItems = 0;
let historyFilteredData = [];

let classificationModalTimer = null;
let winnerConfig = {
    autoShow: true,
    showLimit: 1,
    displayTime: 15
};
let winnerShowCount = 0;
let currentSessionId = null;
let classificationModalShown = false;
let currentIp = null;
let manualIp = null;
let resizeTimer = null;
let columnsConfig = {
    desktop: [],
    mobile: []
};


function toggleResponsiveMenu() {
    const menu = document.getElementById('responsiveMenu');
    if (!menu) return;
    menu.classList.toggle('open');
}


function closeResponsiveMenu() {
    const menu = document.getElementById('responsiveMenu');
    if (menu) menu.classList.remove('open');
}


function navigateToPanel(panelName) {
    // 1. Cerrar el menú
    closeResponsiveMenu();
    
    // 2. Cambiar el panel activo
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const targetPanel = document.getElementById(`panel-${panelName}`);
    if (targetPanel) {
        targetPanel.classList.add('active');
    }
    
    // 3. Actualizar enlaces activos (escritorio)
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
    const desktopLink = document.querySelector(`.nav-links a[data-panel="${panelName}"]`);
    if (desktopLink) desktopLink.classList.add('active');
    
    // 4. Actualizar enlaces activos (móvil)
    document.querySelectorAll('#responsiveMenu a').forEach(a => a.classList.remove('active'));
    const mobileLink = document.querySelector(`#responsiveMenu a[data-panel="${panelName}"]`);
    if (mobileLink) mobileLink.classList.add('active');
    
    // 5. Si el panel es 'system', cargar datos específicos
    if (panelName === 'system') {
        loadTransponderHealth();
        loadAntennaConfig();
        loadDbStats();
        loadBackupsList();
        loadTimingConfig();
        cargarIpConexion();
        loadPilotosBackupsList();
    }
    
    // 6. Si el panel es 'drivers', cargar datos
    if (panelName === 'drivers') {
        loadDrivers();
        loadTranspondersIntoSelect();
    }
    
    // 7. Si el panel es 'transponders', cargar datos
    if (panelName === 'transponders') {
        loadTransponders();
    }
    
    // 8. Si el panel es 'history', cargar historial
    if (panelName === 'history') {
        loadRaceHistory();
        loadPilotHistoryList('');
        setupHistorySearch();
    }
    
    // 9. Si tenemos datos globales, actualizar paneles
    if (globalRaceData && (panelName === 'tableroPublico' || panelName === 'live' || panelName === 'public' || panelName === 'tv')) {
        const session = globalRaceData.session;
        const leaderboard = globalRaceData.leaderboard;
        const speeds = globalRaceData.speeds || {};
        const timesMap = {};
        
        if (panelName === 'tableroPublico') {
            loadTableroPublicoFromData(session, leaderboard, speeds);
        } else if (panelName === 'live') {
            renderLiveLeaderboardPublicStyle(leaderboard, session, speeds, timesMap);
            updateLiveHeader(session);
        } else if (panelName === 'public') {
            loadPublicViewFromData(session, leaderboard, speeds);
        } else if (panelName === 'tv') {
            loadTvViewFromData(session, leaderboard, speeds);
        }
    }
}


// 1. Botón de hamburguesa
document.getElementById('menuToggle')?.addEventListener('click', function(e) {
    e.stopPropagation();
    toggleResponsiveMenu();
});

// 2. Botón de cierre (✕)
document.getElementById('closeResponsiveMenuBtn')?.addEventListener('click', function(e) {
    e.stopPropagation();
    closeResponsiveMenu();
});

// 3. Enlaces del menú responsive - NAVEGACIÓN COMPLETA
document.querySelectorAll('#responsiveMenu a').forEach(link => {
    link.addEventListener('click', function() {
        const panelName = this.getAttribute('data-panel');
        if (panelName) {
            navigateToPanel(panelName); // Tu función de navegación
        }
        closeResponsiveMenu();
    });
})

// 4. Cerrar menú al hacer clic fuera
document.addEventListener('click', function(e) {
    const menu = document.getElementById('responsiveMenu');
    const toggle = document.getElementById('menuToggle');
    if (!menu || !toggle) return;
    
    if (menu.classList.contains('open')) {
        const isClickInsideMenu = menu.contains(e.target);
        const isClickOnToggle = toggle.contains(e.target);
        
        if (!isClickInsideMenu && !isClickOnToggle) {
            closeResponsiveMenu();
        }
    }
});

// 5. Cerrar menú con tecla ESC
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeResponsiveMenu();
    }
});
function setupNavigation() {
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const panelName = this.getAttribute('data-panel');
            if (panelName) {
                navigateToPanel(panelName);
            }
        });
    });
}

// Inicializar navegación
setupNavigation();





// Refrescar lista de todos los transponders
document.getElementById('refreshAllTranspondersBtn')?.addEventListener('click', function () {
    loadTransponders();
    showToast('🔄', 'Lista de transponders actualizada', 'info');
});

// Refrescar historial de respaldos
document.getElementById('refreshBackupsBtn')?.addEventListener('click', function () {
    loadBackupsList();
    showToast('🔄', 'Historial de respaldos actualizado', 'info');
});



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
                showToast('Sesión expirada', 'Por favor inicia sesión nuevamente.', 'warning');
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

function getTimeColorClass(seconds) {
    if (!seconds) return '';
    if (seconds < 60) return 'time-fast';
    if (seconds < 90) return 'time-medium';
    return 'time-slow';
}

function normalizeRaceMode(value) {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'time_attack' || v === 'time-attack' || v === 'timeattack' || v === 'ta') return 'time_attack';
    if (v === 'classification' || v === 'clasificacion' || v === 'class' || v === 'cl') return 'classification';
    if (v === 'endurance' || v === 'enduro' || v === 'en') return 'endurance';
    return 'position';
}


function getTimeAttackElapsedSeconds(driver) {
    // Priorizar accumulated_lap_time (suma de tiempos de vuelta)
    if (driver.accumulated_lap_time != null && driver.accumulated_lap_time > 0) {
        return driver.accumulated_lap_time;
    }
    if (driver.is_finished && driver.race_total_time && driver.race_total_time > 0) {
        return driver.race_total_time;
    }
    return null;
}
function renderRaceClock() {
    let seconds = raceTimerState.seconds;
    if (raceTimerState.status === 'active') {
        seconds += (Date.now() - raceTimerState.lastSyncMs) / 1000;
    }
    const label = formatRaceClock(seconds);

    // ⭐ ACTUALIZAR LOS CRONÓMETROS GENERALES DE CARRERA ⭐
    ['liveTotalTime', 'publicRaceClock', 'tvRaceClock'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.innerText = label;
            // Eliminar clases antiguas y agregar la nueva
            el.classList.remove('status-pending', 'status-active', 'status-paused', 'status-completed', 'status-timeout');
            el.classList.add(`status-${raceTimerState.status}`);
        }
    });
}

function raceModeLabel(mode) {
    const m = normalizeRaceMode(mode);
    if (m === 'time_attack') return 'CLASIFICACIÓN';
    if (m === 'classification') return 'CLASIFICACIÓN';
    if (m === 'endurance') return 'ENDURANCE';
    return 'CARRERA';
}

function raceModeDescription(mode) {
    const m = normalizeRaceMode(mode);
    if (m === 'time_attack') {
        return '⏱️ TIME ATTACK: Gana el piloto con el menor tiempo acumulado completando TODAS las vueltas. Los que no completen todas las vueltas quedan DESCLASIFICADOS (DNQ).';
    }
    if (m === 'classification') {
        return '🏁 CLASIFICACIÓN: Gana el piloto con la MEJOR vuelta dentro del tiempo límite.';
    }
    if (m === 'endurance') {
        return '🏆 ENDURANCE: Gana el piloto con MÁS vueltas completadas en el tiempo límite. Desempate: menor tiempo acumulado.';
    }
    return '🏎️ CARRERA: Gana el primero en cruzar la meta después de completar todas las vueltas.';
}

function applyRaceTimerState(session) {
    raceTimerState = {
        seconds: Number(session?.race_elapsed_seconds || 0),
        status: session?.status || 'pending',
        lastSyncMs: Date.now()
    };
    renderRaceClock();
}

function toggleTimeLimitInput() {
    const raceModeSelect = document.getElementById('newRaceMode');
    if (!raceModeSelect) return;

    const raceMode = raceModeSelect.value;
    const normalized = normalizeRaceMode(raceMode);

    const timeLimitContainer = document.getElementById('timeLimitContainer');
    const enduranceContainer = document.getElementById('enduranceContainer');
    const lapsLimitContainer = document.getElementById('lapsLimitContainer'); // El campo de vueltas

    // ✅ Ocultar TODOS los contenedores primero
    if (timeLimitContainer) timeLimitContainer.style.display = 'none';
    if (enduranceContainer) enduranceContainer.style.display = 'none';

    // ✅ Mostrar el que corresponde según el modo seleccionado
    if (normalized === 'classification') {
        if (timeLimitContainer) timeLimitContainer.style.display = 'block';
        // ✅ Ocultar el campo de vueltas para TIME LIMIT
        if (lapsLimitContainer) lapsLimitContainer.style.display = 'none';
    } else if (normalized === 'endurance') {
        if (enduranceContainer) enduranceContainer.style.display = 'block';
        // ✅ Ocultar el campo de vueltas para ENDURANCE
        if (lapsLimitContainer) lapsLimitContainer.style.display = 'none';
    } else {
        // ✅ Para POSITION RACE y TIME ATTACK, mostrar el campo de vueltas
        if (lapsLimitContainer) lapsLimitContainer.style.display = 'block';
    }
}

function toggleExtraDriverFields() {
    const extra = document.getElementById('extraDriverFields');
    const btn = document.getElementById('toggleExtraFieldsBtn');
    if (!extra || !btn) return;
    if (extra.style.display === 'none' || extra.style.display === '') {
        extra.style.display = 'block';
        btn.innerHTML = '▲ Menos campos';
    } else {
        extra.style.display = 'none';
        btn.innerHTML = '▼ Más campos';
    }
}

function updateRaceControls(session) {
    const status = session?.status || 'pending';
    const raceMode = session?.race_mode || 'position';
    const btnStart = document.getElementById('startRaceBtn');
    const btnPause = document.getElementById('pauseRaceBtn');
    const btnResume = document.getElementById('resumeRaceBtn');
    const btnFinish = document.getElementById('finishRaceBtn');
    const btnRepeat = document.getElementById('repeatRaceBtn');
    const btnResetBoard = document.getElementById('resetBoardBtn');
    const showWinnerBtn = document.getElementById('showWinnerBtn');
    const showClassificationBtn = document.getElementById('showClassificationBtn');

    if (!(btnStart && btnPause && btnResume && btnFinish && btnRepeat && btnResetBoard)) return;

    // ✅ SIEMPRE ocultar ambos botones primero
    if (showWinnerBtn) showWinnerBtn.style.display = 'none';
    if (showClassificationBtn) showClassificationBtn.style.display = 'none';

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
        btnRepeat.disabled = false;
        btnResetBoard.disabled = false;

        // ✅ SOLO mostrar el botón correspondiente si está COMPLETED
        const normalizedMode = normalizeRaceMode(raceMode);
        if (normalizedMode === 'classification') {
            if (showClassificationBtn) showClassificationBtn.style.display = 'inline-block';
        } else {
            if (showWinnerBtn) showWinnerBtn.style.display = 'inline-block';
        }
    } else {
        // ✅ PENDING: ocultar todo
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
        document.getElementById('minSignalSlider').value = res.min_signal || 5;
        document.getElementById('minSignalValue').value = res.min_signal || 5;
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

if (document.getElementById('refreshTranspondersBtn')) {
    document.getElementById('refreshTranspondersBtn').onclick = () => {
        loadTransponders();
    };
}

function showModal(title, message, onConfirm) {
    document.getElementById('modalConfirm').style.display = 'inline-block';
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



document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const panelId = link.dataset.panel;
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`panel-${panelId}`).classList.add('active');
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        link.classList.add('active');

        if (panelId === 'drivers') {
            loadDrivers();
            loadTranspondersIntoSelect();
        }
        if (panelId === 'transponders') {
            loadTransponders();
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
        if (panelId === 'history') {
            loadRaceHistory();
            loadPilotHistoryList(''); // Carga todos los pilotos
            setupHistorySearch();
        }

        // ✅ Si ya tenemos datos globales, actualizar el panel inmediatamente
        if (globalRaceData && (panelId === 'tableroPublico' || panelId === 'live' || panelId === 'public' || panelId === 'tv')) {
            const session = globalRaceData.session;
            const leaderboard = globalRaceData.leaderboard;
            const speeds = globalRaceData.speeds || {};
            const timesMap = {};

            if (panelId === 'tableroPublico') {
                loadTableroPublicoFromData(session, leaderboard, speeds);
            } else if (panelId === 'live') {
                renderLiveLeaderboardPublicStyle(leaderboard, session, speeds, timesMap);
                updateLiveHeader(session);
            } else if (panelId === 'public') {
                loadPublicViewFromData(session, leaderboard, speeds);
            } else if (panelId === 'tv') {
                loadTvViewFromData(session, leaderboard, speeds);
            }
        }
    });
});

async function loadLiveData() {
    try {
        const fullData = await apiCall('/api/dashboard/full-data');

        if (!fullData || !fullData.active) {
            applyRaceTimerState(null);
            updateRaceControls(null);
            const showWinnerBtn = document.getElementById('showWinnerBtn');
            if (showWinnerBtn) showWinnerBtn.style.display = 'none';
            await loadUsbAndSignals();
            return;
        }

        const session = fullData.session;
        const leaderboard = fullData.leaderboard;
        const lapDetails = fullData.lap_details;
        const speeds = fullData.speeds || {};

        currentRaceMode = normalizeRaceMode(session.race_mode);

        // Guardar en variable global
        globalRaceData = fullData;
        globalSessionId = session.id;

        const status = session.status || 'pending';

        if (status === 'active' || status === 'pending') {
            resetWinnerModalFlag();
        }

        if (status === 'completed') {
            const loaderOverlay = document.getElementById('loaderOverlay');
            if (loaderOverlay && loaderOverlay.style.display === 'flex') hideLoader();
        }

        applyRaceTimerState(session);
        updateRaceControls(session);
        updateLiveHeader(session);

        // Actualizar estadísticas básicas
        const circuitNameEl = document.getElementById('circuitName');
        if (circuitNameEl) circuitNameEl.innerText = session.circuit_name || '--';

        const lapsLimitEl = document.getElementById('lapsLimit');
        if (lapsLimitEl) lapsLimitEl.innerText = session.laps_limit || '--';

        let driverCount = leaderboard?.length || 0;
        if (driverCount === 0 && session && session.id) {
            try {
                const raceDrivers = await apiCall(`/api/race/drivers/${session.id}`);
                if (raceDrivers && raceDrivers.length > 0) {
                    driverCount = raceDrivers.length;
                    console.log('[DEBUG] Pilotos obtenidos desde race_drivers:', driverCount);
                }
            } catch (e) { console.warn('[DEBUG] Error obteniendo race_drivers:', e); }
        }

        const totalDriversEl = document.getElementById('totalDrivers');
        if (totalDriversEl) totalDriversEl.innerText = driverCount;

        const finishedDriversEl = document.getElementById('finishedDrivers');
        if (finishedDriversEl) finishedDriversEl.innerText = leaderboard?.filter(d => d.is_finished).length || 0;

        const raceNameLabel = document.getElementById('raceNameForEnrollment');
        if (raceNameLabel) raceNameLabel.innerText = session.circuit_name || '--';
        const raceModeLabelEl = document.getElementById('raceModeForEnrollment');
        if (raceModeLabelEl) raceModeLabelEl.innerText = raceModeLabel(session.race_mode);
        const raceDescLabelEl = document.getElementById('raceDescForEnrollment');
        if (raceDescLabelEl) raceDescLabelEl.innerText = raceModeDescription(session.race_mode);

        // Obtener tiempos individuales
        const individualTimes = await apiCall(`/api/race/driver-times/${session.id}`);
        const timesMap = {};
        if (individualTimes && Array.isArray(individualTimes)) {
            individualTimes.forEach(t => {
                timesMap[t.driver_id] = t.individual_time_formatted || '--';
            });
        }

        // Actualizar leaderboard del panel de control
        const tbody = document.getElementById('leaderboardBody');
        if (tbody) {
            if (leaderboard && leaderboard.length > 0) {
                tbody.innerHTML = leaderboard.map(d => {
                    const raceModeForPanel = normalizeRaceMode(session.race_mode);
                    let isWinner;
                    if (raceModeForPanel === 'time_attack') {
                        isWinner = d.position === 1 && status === 'completed';
                    } else {
                        isWinner = d.position === 1 && (d.is_finished || status === 'completed');
                    }
                    const winnerTag = isWinner ? '<span class="winner-pill">Ganador</span>' : '';
                    let individualTime;
                    if (raceModeForPanel === 'time_attack') {
                        individualTime = d.real_total_time ? formatRaceClock(d.real_total_time) : '--';
                    } else {
                        individualTime = timesMap[d.driver_id] || '--';
                    }
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

        const refreshTimeEl = document.getElementById('refreshTime');
        if (refreshTimeEl) refreshTimeEl.innerHTML = new Date().toLocaleTimeString();

        // ✅ USAR LOS MISMOS DATOS PARA TODOS LOS PANELES
        renderLiveLeaderboardPublicStyle(leaderboard, session, speeds, timesMap);
        applyColumnsConfig();  // ✅ AGREGADO: Aplicar configuración de columnas después de renderizar el leaderboard

        if (document.getElementById('liveLeaderName')) {
            const leader = leaderboard?.[0];
            document.getElementById('liveLeaderName').innerText = leader ? (leader.full_name || leader.name) : '--';
        }

        renderLapsDetailFromCache(lapDetails, leaderboard);
        renderTvRotatorFromCache(lapDetails, leaderboard);

        // ✅ ACTUALIZAR TODOS LOS PANELES CON LOS MISMOS DATOS
        loadTableroPublicoFromData(session, leaderboard, speeds);
        loadPublicViewFromData(session, leaderboard, speeds);
        loadTvViewFromData(session, leaderboard, speeds);
        applyColumnsConfig();  // ✅ AGREGADO: Aplicar configuración de columnas después de actualizar todos los paneles
        await updateTimeRemaining();

        if (status === 'completed' && !winnerModalShown) {
            const podiumRes = await apiCall('/api/session/current/podium');
            const podium = podiumRes?.podium || [];
            const podiumRaceMode = normalizeRaceMode(podiumRes?.race_mode || 'position');
            currentRaceMode = podiumRaceMode;

            if (podiumRaceMode === 'classification') {
                const groups = podiumRes?.classification_groups;
                if (groups && (groups.q1?.length || groups.q2?.length || groups.q3?.length || groups.dnq?.length)) {
                    // ✅ AUTOMÁTICO: manual = false
                    showClassificationModal(groups.q1, groups.q2, groups.q3, groups.dnq, false);
                    winnerModalShown = true;
                }
            } else if (podium.length) {
                // ✅ AUTOMÁTICO: manual = false
                showWinnerModalComplete(podium[0], podium[1], podium[2], false);
                winnerModalShown = true;
            }
        }
        // Al final de loadLiveData(), después de actualizar todos los paneles
        const activePanel = document.querySelector('.panel.active');
        if (activePanel) {
            const panelId = activePanel.id;
            if (panelId === 'panel-live') {
                // Refrescar el panel de control con los mismos datos
                renderLiveLeaderboardPublicStyle(leaderboard, session, speeds, timesMap);
                applyColumnsConfig();  // ✅ AGREGADO: Aplicar configuración al refrescar el panel live
                updateLiveHeader(session);
            }
        }

    } catch (error) {
        console.error("Error en loadLiveData:", error);
    }

    await loadUsbAndSignals();
}

async function updateTimeRemaining() {
    try {
        const session = await apiCall('/api/session/current');
        if (!session || !session.session) return;

        const raceMode = normalizeRaceMode(session.session.race_mode);
        const isTimedMode = (raceMode === 'endurance' || raceMode === 'classification');
        const status = session.session.status || 'pending';

        // Obtener elementos
        const timerBox = document.getElementById('timeRemainingBox');
        const publicTimerBox = document.getElementById('publicTimeRemainingBox');
        const tvTimerBox = document.getElementById('tvTimeRemaining');

        // Si no es modo con tiempo O está pendiente, OCULTAR TODO
        if (!isTimedMode || status === 'pending') {
            if (timerBox) { timerBox.style.display = 'none'; }
            if (publicTimerBox) { publicTimerBox.style.display = 'none'; }
            if (tvTimerBox) { tvTimerBox.style.display = 'none'; }
            return;
        }

        // ⭐ PAUSA: congelar display, no llamar API
        if (status === 'paused') {
            if (timerBox) {
                timerBox.style.display = 'block';
                timerBox.className = 'race-timer-box time-remaining-status-active';
            }
            if (publicTimerBox) {
                publicTimerBox.style.display = 'block';
                publicTimerBox.className = 'race-timer-box time-remaining-status-active';
            }
            if (tvTimerBox) {
                tvTimerBox.style.display = 'inline-block';
                tvTimerBox.className = 'race-timer-box time-remaining-status-active';
                tvTimerBox.style.fontSize = '0.85rem';
                tvTimerBox.style.padding = '2px 10px';
            }
            return;  // No actualizar, dejar congelado
        }

        // Obtener tiempo restante
        const res = await apiCall('/api/race/time-remaining');
        if (!res || !res.success) {
            if (timerBox) { timerBox.style.display = 'none'; }
            if (publicTimerBox) { publicTimerBox.style.display = 'none'; }
            if (tvTimerBox) { tvTimerBox.style.display = 'none'; }
            return;
        }

        const formatted = res.remaining_formatted || '00:00.000';
        const remaining = res.remaining_seconds || 0;
        const isActive = res.is_active || false;

        // === ACTUALIZAR BOX DE TIEMPO RESTANTE (Control de Carrera) ===
        if (timerBox) {
            if (status === 'completed' || (!isActive && remaining <= 0)) {
                // ✅ TIEMPO CUMPLIDO: Verde congelado en 00:00.000
                timerBox.style.display = 'block';
                timerBox.innerText = '00:00.000';
                timerBox.className = 'race-timer-box time-remaining-status-completed';
            } else if (isActive && remaining > 0) {
                timerBox.style.display = 'block';
                timerBox.innerText = formatted;
                if (remaining < 60) {
                    timerBox.className = 'race-timer-box time-remaining-status-active-warning';
                } else {
                    timerBox.className = 'race-timer-box time-remaining-status-active';
                }
            } else {
                timerBox.style.display = 'none';
            }
        }

        // === PANEL PÚBLICO ===
        if (publicTimerBox) {
            if (status === 'completed' || (!isActive && remaining <= 0)) {
                publicTimerBox.style.display = 'block';
                publicTimerBox.innerText = '00:00.000';
                publicTimerBox.className = 'race-timer-box time-remaining-status-completed';
            } else if (isActive && remaining > 0) {
                publicTimerBox.style.display = 'block';
                publicTimerBox.innerText = formatted;
                if (remaining < 60) {
                    publicTimerBox.className = 'race-timer-box time-remaining-status-active-warning';
                } else {
                    publicTimerBox.className = 'race-timer-box time-remaining-status-active';
                }
            } else {
                publicTimerBox.style.display = 'none';
            }
        }

        // === TV / PIT WALL ===
        if (tvTimerBox) {
            if (status === 'completed' || (!isActive && remaining <= 0)) {
                tvTimerBox.style.display = 'inline-block';
                tvTimerBox.innerText = '00:00.000';
                tvTimerBox.className = 'race-timer-box time-remaining-status-completed';
                tvTimerBox.style.fontSize = '0.85rem';
                tvTimerBox.style.padding = '2px 10px';
            } else if (isActive && remaining > 0) {
                tvTimerBox.style.display = 'inline-block';
                tvTimerBox.innerText = formatted;
                tvTimerBox.className = 'race-timer-box';
                tvTimerBox.style.fontSize = '0.85rem';
                tvTimerBox.style.padding = '2px 10px';
                if (remaining < 60) {
                    tvTimerBox.classList.add('time-remaining-status-active-warning');
                } else {
                    tvTimerBox.classList.add('time-remaining-status-active');
                }
            } else {
                tvTimerBox.style.display = 'none';
            }
        }

    } catch (e) {
        console.error('Error en updateTimeRemaining:', e);
        // Ocultar todo en caso de error
        const timerBox = document.getElementById('timeRemainingBox');
        if (timerBox) timerBox.style.display = 'none';
        const publicTimerBox = document.getElementById('publicTimeRemainingBox');
        if (publicTimerBox) publicTimerBox.style.display = 'none';
        const tvTimerBox = document.getElementById('tvTimeRemaining');
        if (tvTimerBox) tvTimerBox.style.display = 'none';
    }
}

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


function renderLapsDetailFromCache(lapDetails, leaderboard) {
    const container = document.getElementById('liveLapsDetail');
    if (!container) return;

    if (!leaderboard || !leaderboard.length) {
        container.innerHTML = '<p class="muted-text" style="text-align:center;">Sin datos de vueltas</p>';
        return;
    }

    // ✅ Obtener la mejor vuelta del líder (para comparar)
    let leaderBestLap = null;
    let leaderName = '';
    if (globalRaceData && globalRaceData.leaderboard && globalRaceData.leaderboard.length > 0) {
        const leader = globalRaceData.leaderboard[0];
        leaderBestLap = leader.best_lap;
        leaderName = leader.full_name || leader.name;
    }

    container.innerHTML = leaderboard.map(driver => {
        const laps = lapDetails[driver.driver_id] || [];
        if (!laps.length) {
            return `<div class="lap-box"><h4>${driver.full_name || driver.name}</h4><div style="padding:0.5rem;">Sin vueltas</div></div>`;
        }

        // ✅ Mostrar vueltas en orden descendente (última primero)
        const sortedLaps = [...laps].sort((a, b) => b.lap_number - a.lap_number);

        const rows = sortedLaps.map(lap => {
            const lapTime = lap.lap_seconds !== null ? formatRaceClock(lap.lap_seconds) : '--';
            let gapToLeader = '--';

            // ✅ Calcular diferencia con la mejor vuelta del líder
            if (leaderBestLap && lap.lap_seconds) {
                const diff = lap.lap_seconds - leaderBestLap;
                if (Math.abs(diff) < 0.01) {
                    gapToLeader = 'Líder';
                } else if (diff > 0) {
                    gapToLeader = `+${diff.toFixed(3)}s`;
                } else {
                    gapToLeader = `-${Math.abs(diff).toFixed(3)}s`;
                }
            }

            const speed = lap.avg_speed_kmh ? Math.round(lap.avg_speed_kmh) : '--';

            return `
                <tr style="border-bottom: 1px solid #2a3240;">
                    <td style="text-align: center; padding: 6px;">V${lap.lap_number}</td>
                    <td style="text-align: center; font-family: monospace; padding: 6px;">${lapTime}</td>
                    <td style="text-align: center; padding: 6px; ${gapToLeader !== '--' && gapToLeader !== 'Líder' ? 'color: #ffd700;' : ''}">${gapToLeader}</td>
                    <td style="text-align: center; padding: 6px;">${speed} km/h</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="lap-box">
                <h4>${driver.full_name || driver.name}</h4>
                <div style="overflow-x: auto; max-height: 250px; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr">
                                <th style="text-align: center; padding: 8px;">Vuelta</th>
                                <th style="text-align: center; padding: 8px;">Tiempo</th>
                                <th style="text-align: center; padding: 8px;">Dif. Líder</th>
                                <th style="text-align: center; padding: 8px;">Vel.</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');
}

function renderTvRotatorFromCache(lapDetails, leaderboard) {
    const container = document.getElementById('liveTvLapsRotator');
    if (!container) return;

    if (!leaderboard || !leaderboard.length) {
        container.innerHTML = '<p class="muted-text">Esperando datos...</p>';
        return;
    }

    if (cachedRotatorData.length === 0 || cachedRotatorData.length !== leaderboard.length) {
        cachedRotatorData = leaderboard.map(d => ({
            driver: d,
            laps: lapDetails[d.driver_id] || []
        }));
        currentRotatorIndex = 0;

        // ✅ INICIAR INTERVALO SI NO EXISTE
        if (tvRotatorInterval) clearInterval(tvRotatorInterval);
        tvRotatorInterval = setInterval(() => {
            if (cachedRotatorData.length > 0) {
                currentRotatorIndex = (currentRotatorIndex + 1) % cachedRotatorData.length;
                updateRotatorDisplay(container);
            }
        }, 5000);
    } else {
        // Actualizar datos si cambiaron
        for (let i = 0; i < leaderboard.length; i++) {
            const driver = leaderboard[i];
            const newLapsCount = lapDetails[driver.driver_id]?.length || 0;
            if (cachedRotatorData[i] && cachedRotatorData[i].laps.length !== newLapsCount) {
                cachedRotatorData[i] = { driver: driver, laps: lapDetails[driver.driver_id] || [] };
            }
        }
    }

    function updateRotatorDisplay(container) {
        if (!cachedRotatorData.length) return;
        const current = cachedRotatorData[currentRotatorIndex % cachedRotatorData.length];
        const driverName = current.driver.full_name || current.driver.name;
        // ✅ usar slice().reverse() para NO modificar original
        const recentLaps = current.laps.slice().reverse();

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

    updateRotatorDisplay(container);
}

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

    const DEFAULT_PHOTO = '/static/default-avatar.png';

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

    const publicTimerEl = document.getElementById('publicTimeRemainingDisplay');
    if (publicTimerEl) {
        const res = await apiCall('/api/race/time-remaining');
        if (res && res.success && res.is_active) {
            publicTimerEl.style.display = 'block';
            publicTimerEl.innerText = `${res.remaining_formatted}`;
            if (res.remaining_seconds <= 0) {
                publicTimerEl.innerText = '¡TIEMPO CUMPLIDO!';
                publicTimerEl.style.color = '#ffd700';
            }
        } else {
            publicTimerEl.style.display = 'none';
        }
    }

    const individualTimes = await apiCall(`/api/race/driver-times/${session.id}`);
    const timesMap = {};
    if (individualTimes && Array.isArray(individualTimes)) {
        individualTimes.forEach(t => { timesMap[t.driver_id] = t.individual_time_formatted || '--'; });
    }

    if (raceTimer) {
        let seconds = session.race_elapsed_seconds || 0;
        if (session.status === 'active') {
            seconds += (Date.now() - raceTimerState.lastSyncMs) / 1000;
        }
        raceTimer.innerText = formatRaceClock(seconds);
    }

    if (!leaderboard.length) {
        listaPilotos.innerHTML = '';
        return;
    }

    const raceMode = normalizeRaceMode(session.race_mode);

    listaPilotos.innerHTML = leaderboard.map((driver, idx) => {
        const color = driverColors[idx % driverColors.length];
        const best = driver.best_lap != null && driver.best_lap > 0 ? formatRaceClock(driver.best_lap) : '--';

        let calculatedTotalTime = '--';
        if (driver.first_detection && driver.last_detection) {
            const first = new Date(driver.first_detection).getTime();
            const last = new Date(driver.last_detection).getTime();
            if (!isNaN(first) && !isNaN(last) && last > first) {
                const diffSeconds = (last - first) / 1000;
                calculatedTotalTime = formatRaceClock(diffSeconds);
            }
        }

        const individualTime = driver.total_time != null ? formatRaceClock(driver.total_time) : calculatedTotalTime;

        let totalTime = '--';
        if (session.race_elapsed_seconds !== undefined && session.race_elapsed_seconds !== null) {
            let seconds = session.race_elapsed_seconds;
            if (session.status === 'active') {
                seconds += (Date.now() - raceTimerState.lastSyncMs) / 1000;
            }
            totalTime = formatRaceClock(seconds);
        }

        let tiempoPrincipal = '--';
        let tiempoSecundario = '--';

        if (raceMode === 'time_attack') {
            const driverTotal = (driver.race_total_time != null && driver.race_total_time > 0)
                ? formatRaceClock(driver.race_total_time)
                : '--';
            tiempoPrincipal = driverTotal;

            let tiempoTranscurrido = '--';
            if (driver.first_detection) {
                const now = Date.now();
                const firstDetMs = new Date(driver.first_detection).getTime();
                if (!isNaN(firstDetMs)) {
                    const elapsedSec = (now - firstDetMs) / 1000;
                    if (driver.is_finished && driver.race_total_time != null && driver.race_total_time > 0) {
                        tiempoTranscurrido = formatRaceClock(driver.race_total_time);
                    } else {
                        tiempoTranscurrido = elapsedSec > 0 ? formatRaceClock(elapsedSec) : '--';
                    }
                }
            }
            tiempoSecundario = tiempoTranscurrido;

        } else if (raceMode === 'classification') {
            const bestLap = driver.best_lap ? formatRaceClock(driver.best_lap) : '--';
            tiempoPrincipal = bestLap;
            tiempoSecundario = `${driver.total_laps || 0} v`;

        } else if (raceMode === 'endurance') {
            const bestLap = driver.best_lap ? formatRaceClock(driver.best_lap) : '--';
            tiempoPrincipal = `${driver.total_laps || 0} v`;
            tiempoSecundario = bestLap;

        } else {
            tiempoPrincipal = individualTime;
            tiempoSecundario = totalTime;
        }

        const speed = speedsMap[driver.driver_id];
        const speedValue = (speed && speed > 0 && speed < 400) ? `${Math.round(speed)}` : '--';

        const rowClass = idx === 0 ? 'row-first' : '';
        const progressLineClass = idx === 0 ? 'line-gold' : 'line-blue';
        const kartLabel = driver.kart_id ? driver.kart_id : driver.transponder_id || '--';

        const photoUrl = driver.photo && driver.photo !== 'default-avatar.png'
            ? `/static/uploads/drivers/${driver.photo}`
            : DEFAULT_PHOTO;

        let cupIcon = '';
        if (raceMode === 'time_attack') {
            if (session.status === 'completed') {
                if (idx === 0) cupIcon = ' 🏆';
                else if (idx === 1) cupIcon = ' 🥈';
                else if (idx === 2) cupIcon = ' 🥉';
            }
        } else {
            if (driver.is_finished && driver.total_laps >= (session.laps_limit || 0)) {
                if (idx === 0) cupIcon = ' 🏆';
                else if (idx === 1) cupIcon = ' 🥈';
                else if (idx === 2) cupIcon = ' 🥉';
            }
        }

        return `
            <div class="k-row ${rowClass}">
                <div class="k-col-pos">${driver.position || (idx + 1)}</div>
                <div class="k-col-name">
                    <img src="${photoUrl}" class="driver-photo-leaderboard" onerror="this.src='${DEFAULT_PHOTO}'">
                    <span class="driver-name">${driver.full_name || driver.name}${cupIcon}</span>
                    <div class="progress-line ${progressLineClass}" style="background: linear-gradient(90deg, ${color}, transparent);"></div>
                </div>
                <div class="k-col-vueltas">${driver.total_laps || 0}/${session.laps_limit || 0}</div>
                <div class="k-col-dif"><span class="time-box box-black">${driver.gap || (idx === 0 ? 'Líder' : '--')}</span></div>
                <div class="k-col-mejor"><span class="time-box box-gold">${best}</span></div>
                <div class="k-col-tiempo"><span class="time-box box-black">${tiempoPrincipal}</span></div>
                <div class="k-col-tiempo-individual"><span class="time-box box-black">${tiempoSecundario}</span></div>
                <div class="k-col-velocidad">
                    <span class="time-box box-black">${speedValue} <span style="color: yellow; font-size: 0.6rem; margin-left: 2px;">km/h</span></span>
                </div>
                <div class="k-col-kart"><span class="kart-circle" style="background-color: ${color};">${kartLabel}</span></div>
            </div>
        `;
    }).join('');

    applyColumnsConfig();
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
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;">Sin carrera activa</td></tr>';
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

    if (publicRaceName) publicRaceName.innerText = session.circuit_name || '--';
    if (publicLapsLimit) publicLapsLimit.innerText = session.laps_limit || '--';
    if (publicRaceMode) publicRaceMode.innerText = raceModeLabel(session.race_mode);
    if (publicRaceDescription) publicRaceDescription.innerText = raceModeDescription(session.race_mode);
    if (publicRaceLabel) publicRaceLabel.innerText = session.circuit_name || '--';
    if (publicRaceStatus) publicRaceStatus.innerText = session.status || 'pending';
    if (publicDriversCount) publicDriversCount.innerText = String(leaderboard.length || 0);

    const leader = leaderboard[0];
    if (publicLeaderName) publicLeaderName.innerText = leader ? (leader.full_name || leader.name) : '--';

    const individualTimes = await apiCall(`/api/race/driver-times/${session.id}`);
    const timesMap = {};
    if (individualTimes && Array.isArray(individualTimes)) {
        individualTimes.forEach(t => { timesMap[t.driver_id] = t.individual_time_formatted || '--'; });
    }

    const raceMode = normalizeRaceMode(session.race_mode);


    body.innerHTML = leaderboard.map((d, idx) => {
        const best = d.best_lap ? formatRaceClock(d.best_lap) : '--';
        const last = d.last_lap ? formatRaceClock(d.last_lap) : '--';
        const speed = d.avg_speed_kmh ? `${Math.round(d.avg_speed_kmh)} km/h` : '--';
        const position = d.position || (idx + 1);

        // GAP: usar d.gap (viene del backend)
        let gapLeader = d.gap || '--';
        if (idx === 0) gapLeader = 'Líder';

        // Si no hay gap, mostrar diferencia de vueltas
        if (gapLeader === '--' && idx > 0 && leader && d.total_laps !== leader.total_laps) {
            const lapDiff = leader.total_laps - d.total_laps;
            gapLeader = `+${lapDiff} v`;
        }



        // ✅ CALCULAR TIEMPO desde first_detection y last_detection
        let calculatedTotalTime = '--';
        if (d.first_detection && d.last_detection) {
            const first = new Date(d.first_detection).getTime();
            const last = new Date(d.last_detection).getTime();
            if (!isNaN(first) && !isNaN(last) && last > first) {
                const diffSeconds = (last - first) / 1000;
                calculatedTotalTime = formatRaceClock(diffSeconds);
            }
        }

        let total;
        if (raceMode === 'time_attack') {
            total = d.real_total_time ? formatRaceClock(d.real_total_time) : '--';
        } else {
            total = d.total_time ? formatRaceClock(d.total_time) : calculatedTotalTime;
        }


        let isWinner;
        if (raceMode === 'time_attack') {
            isWinner = d.position === 1 && session.status === 'completed';
        } else {
            isWinner = d.position === 1 && (d.is_finished || session.status === 'completed');
        }
        const winnerTag = isWinner ? '<span class="winner-pill">Ganador</span>' : '';

        return `
        <tr>
            <td style="font-weight: bold; font-size: 1.1rem; text-align: center;">${position}</td>
            <td class="${isWinner ? 'winner-name' : ''}">${d.full_name || d.name}${winnerTag}</td>
            <td style="text-align: center;">${d.total_laps || 0}</td>
            <td style="text-align: center; font-weight: bold; color: #ffd700;">${gapLeader}</td>
            <td style="text-align: center;">${total}</td>
            <td class="best-lap" style="text-align: center;">${best}</td>
            <td style="text-align: center;">${last}</td>
            <td style="text-align: center;">${speed}</td>
        </tr>`;
    }).join('');

    // Detalle de vueltas (simplificado)
    const allLapDetails = await Promise.all(
        leaderboard.slice(0, 5).map(async (d) => {
            const laps = await apiCall(`/api/race/lap-details/${session.id}/${d.driver_id}`);
            return { driver: d, laps: Array.isArray(laps) ? laps.slice() : [] };
        })
    );


    let leaderBestLap = null;
    if (globalRaceData && globalRaceData.leaderboard && globalRaceData.leaderboard.length > 0) {
        const leader = globalRaceData.leaderboard[0];
        leaderBestLap = leader.best_lap;
    }

    const lapBlocks = allLapDetails.map(({ driver, laps }) => {
        if (!laps.length) {
            return `<div class="lap-box"><h4>${driver.full_name || driver.name}</h4><div style="padding:0.7rem;">Sin vueltas</div></div>`;
        }

        // Ordenar vueltas por número descendente (última primero)
        const sortedLaps = [...laps].sort((a, b) => b.lap_number - a.lap_number);

        const rows = sortedLaps.map(lap => {
            const lapTime = lap.lap_seconds !== null ? formatRaceClock(lap.lap_seconds) : '--';
            let gapToLeader = '--';

            // Calcular diferencia con la mejor vuelta del líder
            if (leaderBestLap && lap.lap_seconds) {
                const diff = lap.lap_seconds - leaderBestLap;
                if (Math.abs(diff) < 0.01) {
                    gapToLeader = 'Líder';
                } else if (diff > 0) {
                    gapToLeader = `+${diff.toFixed(3)}s`;
                } else {
                    gapToLeader = `-${Math.abs(diff).toFixed(3)}s`;
                }
            }

            return `
                <tr style="border-bottom: 1px solid #2a3240;">
                    <td style="text-align: center; padding: 6px;">V${lap.lap_number}</td>
                    <td style="text-align: center; font-family: monospace; padding: 6px;">${lapTime}</td>
                    <td style="text-align: center; padding: 6px; ${gapToLeader !== '--' && gapToLeader !== 'Líder' ? 'color: #ffd700;' : ''}">${gapToLeader}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="lap-box">
                <h4>${driver.full_name || driver.name}</h4>
                <div style="overflow-x: auto; max-height: 250px; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr>
                                <th style="text-align: center; padding: 8px;">Vuelta</th>
                                <th style="text-align: center; padding: 8px;">Tiempo</th>
                                <th style="text-align: center; padding: 8px;">Dif. Líder</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        `;
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

    const raceMode = normalizeRaceMode(session.race_mode);

    body.innerHTML = leaderboard.map((d, idx) => {

        // ✅ CALCULAR TIEMPO desde first_detection y last_detection
        let calculatedTotalTime = '--';
        if (d.first_detection && d.last_detection) {
            const first = new Date(d.first_detection).getTime();
            const last = new Date(d.last_detection).getTime();
            if (!isNaN(first) && !isNaN(last) && last > first) {
                const diffSeconds = (last - first) / 1000;
                calculatedTotalTime = formatRaceClock(diffSeconds);
            }
        }

        let total;
        if (raceMode === 'time_attack') {
            total = d.real_total_time ? formatRaceClock(d.real_total_time) : '--';
        } else {
            total = d.total_time ? formatRaceClock(d.total_time) : calculatedTotalTime;
        }


        const best = d.best_lap ? formatRaceClock(d.best_lap) : '--';

        // ✅ Usar d.gap del backend
        let gapLeader = d.gap || '--';
        if (idx === 0) gapLeader = 'Líder';

        // Si no hay gap, calcular diferencia de vueltas
        if (gapLeader === '--' && idx > 0 && leader && d.total_laps !== leader.total_laps) {
            const lapDiff = leader.total_laps - d.total_laps;
            gapLeader = `+${lapDiff} v`;
        }

        let isWinner;
        if (raceMode === 'time_attack') {
            isWinner = d.position === 1 && session.status === 'completed';
        } else {
            isWinner = d.position === 1 && (d.is_finished || session.status === 'completed');
        }

        const winnerTag = isWinner ? '<span class="winner-pill">Ganador</span>' : '';

        // ✅ Tabla con 7 columnas: Pos, Piloto, Vtas, Total, Mejor, Vel., Gap
        return `<tr>
            <td style="text-align:center; font-weight:bold;">${d.position || (idx + 1)}</td>
            <td class="${isWinner ? 'winner-name' : ''}">${d.full_name || d.name}${winnerTag}</td>
            <td style="text-align:center;">${d.total_laps || 0}</td>
            <td style="text-align:center;">${total}</td>
            <td class="best-lap" style="text-align:center;">${best}</td>
            <td style="text-align:center;">${formatSpeed(speedsMap && speedsMap[d.driver_id] ? speedsMap[d.driver_id] : null)}</td>
            <td style="text-align:center; font-weight:bold; color:#ffd700;">${gapLeader}</td>
        </tr>`;
    }).join('');

    tvLapDetailsCache = await Promise.all(
        leaderboard.slice(0, 8).map(async (d) => {
            const laps = await apiCall(`/api/race/lap-details/${session.id}/${d.driver_id}`);
            return { driver: d, laps: Array.isArray(laps) ? laps.slice() : [] };
        })
    );
    renderTvLapRotator();
}

async function loadPublicView(preloaded = null, speedsMap = {}) {
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

    const individualTimes = await apiCall(`/api/race/driver-times/${session.id}`);
    const timesMap = {};
    if (individualTimes && Array.isArray(individualTimes)) {
        individualTimes.forEach(t => {
            timesMap[t.driver_id] = t.individual_time_formatted || '--';
        });
    }

    const raceModeForPublic = normalizeRaceMode(session.race_mode);

    body.innerHTML = leaderboard.map((d, idx) => {
        let total;
        if (raceModeForPublic === 'time_attack') {
            total = d.real_total_time ? formatRaceClock(d.real_total_time) : '--';
        } else {
            total = d.total_time ? formatRaceClock(d.total_time) : '--';
        }
        const best = d.best_lap ? formatRaceClock(d.best_lap) : '--';
        const last = d.last_lap ? formatRaceClock(d.last_lap) : '--';
        const individualTime = timesMap[d.driver_id] || '--';
        const position = d.position || (idx + 1);
        let isWinner;
        if (raceModeForPublic === 'time_attack') {
            isWinner = d.position === 1 && session.status === 'completed';
        } else {
            isWinner = d.position === 1 && (d.is_finished || session.status === 'completed');
        }
        const winnerTag = isWinner ? '<span class="winner-pill">Ganador</span>' : '';

        return `<tr>
                <td style="font-weight: bold; font-size: 1.1rem; text-align: center;">${position}</td>
                <td class="${isWinner ? 'winner-name' : ''}">${d.full_name || d.name}${winnerTag}</td>
                <td>${d.total_laps || 0}</td>
                <td>${total}</td>
                <td class="best-lap">${best}</td>
                <td>${formatSpeed(speedsMap && speedsMap[d.driver_id] ? speedsMap[d.driver_id] : null)}</td>
                <td>${last}</td>
            </tr>`;
    }).join('');

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
        const rows = laps.slice().map(l => `
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

    if (lastSessionIdForRotator === sessionId && lastLeaderboardHashForRotator === currentHash && cachedRotatorData.length > 0) {
        for (let i = 0; i < cachedRotatorData.length; i++) {
            const driver = cachedRotatorData[i];
            const freshLaps = await apiCall(`/api/race/lap-details/${sessionId}/${driver.driver.driver_id}`);
            if (freshLaps && freshLaps.length !== driver.laps.length) {
                driver.laps = freshLaps;
            }
        }


        if (cachedRotatorData.length > 0) {
            const current = cachedRotatorData[currentRotatorIndex % cachedRotatorData.length];
            const driverName = current.driver.full_name || current.driver.name;
            const recentLaps = current.laps.slice().reverse();
            if (!recentLaps.length) {
                container.innerHTML = `<h4>${driverName}</h4><p>Sin vueltas registradas</p>`;
            } else {
                container.innerHTML = `<h4>${driverName} - Últimas vueltas</h4>
                    <table class="compact-table"><thead><tr><th>Vuelta</th><th>Tiempo</th><th>Dif.Líder</th><th>Vel.</th></tr></thead>`;
            }
        }
        return;
    }

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
        const recentLaps = current.laps.slice().reverse();

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

async function renderTvLapRotator() {
    const box = document.getElementById('tvLapsRotator');
    if (!box) return;

    // ✅ Obtener largo de pista
    let trackLength = 0;
    if (globalRaceData && globalRaceData.session) {
        trackLength = globalRaceData.session.track_length_km || 0;
    }

    // ✅ Si no hay trackLength, obtenerlo de la API
    if (trackLength === 0) {
        try {
            const config = await apiCall('/api/circuit/config');
            if (config && config.track_length_km) {
                trackLength = config.track_length_km;
            }
        } catch (e) {
            console.warn("[DEBUG] Error obteniendo trackLength:", e);
        }
    }

    if (!tvLapDetailsCache.length) {
        box.innerHTML = '<p class="muted-text">Esperando datos de vueltas...</p>';
        return;
    }

    if (tvRotationIndex >= tvLapDetailsCache.length) tvRotationIndex = 0;

    const current = tvLapDetailsCache[tvRotationIndex];
    if (!current || !current.driver) {
        box.innerHTML = '<p class="muted-text">Esperando datos...</p>';
        return;
    }

    const driverName = current.driver.full_name || current.driver.name || 'Piloto';
    const laps = current.laps || [];

    if (!laps.length) {
        box.innerHTML = `<h4 style="margin:0 0 10px 0; color:#ffd700;">${driverName} - Últimas Vueltas</h4>
                         <p class="muted-text">Aún sin vueltas registradas.</p>`;
        return;
    }

    // Obtener mejor vuelta del líder para calcular diferencia
    let leaderBestLap = null;
    if (globalRaceData && globalRaceData.leaderboard && globalRaceData.leaderboard.length > 0) {
        const leader = globalRaceData.leaderboard[0];
        leaderBestLap = leader.best_lap;
    }

    // Mostrar últimas vueltas primero
    const recentLaps = laps.slice().reverse();

    // ✅ Construir filas de la tabla
    const rows = recentLaps.map((lap) => {
        const lapTime = lap.lap_seconds !== null ? Number(lap.lap_seconds).toFixed(3) : '--';
        let gap = '--';

        if (leaderBestLap && lap.lap_seconds) {
            const diff = lap.lap_seconds - leaderBestLap;
            if (Math.abs(diff) < 0.001) {
                gap = 'Líder';
            } else if (diff > 0) {
                gap = `+${diff.toFixed(3)}s`;
            } else {
                gap = `-${Math.abs(diff).toFixed(3)}s`;
            }
        }

        let speed = '--';
        if (lap.avg_speed_kmh && lap.avg_speed_kmh > 0) {
            speed = Math.round(lap.avg_speed_kmh);
        } else if (lap.lap_seconds && trackLength > 0) {
            const calculatedSpeed = (trackLength / lap.lap_seconds) * 3600;
            if (calculatedSpeed > 0 && calculatedSpeed < 400) {
                speed = Math.round(calculatedSpeed);
            }
        }

        return ` 
            <tr style="border-bottom: 1px solid #2a2f3a;">
                <td style="text-align: center; padding: 8px;">V${lap.lap_number}</td>
                <td style="text-align: center; font-family: monospace; padding: 8px;">${lapTime}s</td>
                <td style="text-align: center; padding: 8px;">${gap}</td>
                <td style="text-align: center; padding: 8px;">${speed} km/h</td>
            </tr>
        `;
    }).join('');

    box.innerHTML = `
        <h4 style="margin:0 0 15px 0; color:#ffd700; font-size:1.1rem;">${driverName} - Últimas Vueltas</h4>
        <div style="overflow-x: auto; max-height: 300px; overflow-y: auto;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 2px solid #cfcfcfb2;">
                        <th style="text-align: center; padding: 10px;">Vuelta</th>
                        <th style="text-align: center; padding: 10px;">Tiempo</th>
                        <th style="text-align: center; padding: 10px;">Dif. Líder</th>
                        <th style="text-align: center; padding: 10px;">Vel.</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
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
                    <td>${formatSpeed(speedsMap && speedsMap[d.driver_id] ? speedsMap[d.driver_id] : null)}</td>
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

    if (!data || !data.active || !data.session) {
        const listaPilotos = document.getElementById('lista-pilotos');
        if (listaPilotos) listaPilotos.innerHTML = '';
        const raceTimer = document.getElementById('total_time');
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

    // ✅ Llamar a la función corregida
    await loadTableroPublicoFromData(session, leaderboard, {});

    applyColumnsConfig();
}

let allDriversData = []; // Cache global para búsquedas

async function loadDrivers(searchTerm) {
    console.log("🔵 loadDrivers iniciada");
    try {
        const drivers = await apiCall('/api/drivers');
        allDriversData = drivers || [];

        // Ordenar por más reciente primero (id DESC)
        allDriversData.sort((a, b) => b.id - a.id);

        renderDriversTable(searchTerm || '');

        // También actualizar los checkboxes de inscripción
        loadEnrollmentCheckboxes(searchTerm || '');
    } catch (e) {
        console.error("Error cargando pilotos:", e);
        const tbody = document.getElementById('driversList');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#ef7a86;">❌ Error al cargar pilotos</td></tr>';
    }

    // ⭐ CARGAR PILOTOS INSCRITOS
    try {
        const session = await apiCall('/api/session/current');
        const raceTbody = document.getElementById('raceDriversList');
        const inscritosCount = document.getElementById('inscritosCount');

        if (raceTbody) {
            if (session?.active && session?.session?.id) {
                const raceDrivers = await apiCall(`/api/race/drivers/${session.session.id}`);
                if (raceDrivers && raceDrivers.length > 0) {
                    raceTbody.innerHTML = raceDrivers.map((d, index) => `
                            <tr>
                                <td style="text-align: center; font-weight: bold">${index + 1}</td>
                                <td>${d.name} ${d.lastname || ''}</td>
                                <td>${d.transponder_id}</td>
                                <td><button class="btn " onclick="removeFromRace(${d.driver_id})" style=" color: white;">❌</button></td>
                            </tr>
                        `).join('');
                    if (inscritosCount) inscritosCount.innerText = raceDrivers.length;
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
}

function renderDriversTable(searchTerm) {
    const tbody = document.getElementById('driversList');
    if (!tbody) return;

    let filtered = allDriversData;
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = allDriversData.filter(d =>
            (d.name || '').toLowerCase().includes(term) ||
            (d.lastname || '').toLowerCase().includes(term) ||
            (d.email || '').toLowerCase().includes(term) ||
            (d.carnet || '').toLowerCase().includes(term) ||
            (d.phone || '').toLowerCase().includes(term) ||
            String(d.transponder_id || '').includes(term) ||
            String(d.id || '').includes(term)
        );
    }

    if (filtered.length > 0) {
        tbody.innerHTML = filtered.map(d => {
            // ✅ CORREGIDO: URL CORRECTA PARA LA FOTO
            const photo = d.photo && d.photo !== 'default-avatar.png'
                ? `/static/uploads/drivers/${d.photo}`
                : '/static/default-avatar.png';

            const kart = d.transponder_kart_id || '--';
            return `<tr data-driver-id="${d.id}">
                <td>${d.id}</td>
                <td style="text-align:center;cursor:pointer;" class="driver-edit-trigger">
                    <img src="${photo}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;" onerror="this.src='/static/default-avatar.png'">
                </td>
                <td style="cursor:pointer;" class="driver-edit-trigger">
                    <span id="name-${d.id}">${d.name} ${d.lastname || ''}</span>
                    ${d.email ? `<br><small style="color:#888;">📧 ${d.email}</small>` : ''}
                    ${d.carnet ? `<br><small style="color:#888;">🪪 ${d.carnet}</small>` : ''}
                    ${d.phone ? `<br><small style="color:#888;">📱 ${d.phone}</small>` : ''}
                </td>
                <td style="font-size:0.72rem;color:#ffd700;text-align:center;font-weight:bold;">${kart}</td>
                <td class="driver-edit-trigger" style="cursor:pointer;">${d.transponder_id || '--'}</td>
                <td>
                    <button class="btn btn-sm driver-edit-trigger">✏️</button>
                    <button class="btn btn-sm" onclick="window.deleteDriver(${d.id})">🗑️</button>
                </td>
            </tr>`;
        }).join('');
    } else {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No hay pilotos registrados</td></tr>';
    }
}

let persistentCheckedIds = new Set();

async function loadEnrollmentCheckboxes(searchTerm) {
    const container = document.getElementById('enrollmentCheckboxList');
    if (!container) return;

    // PASO 1: Sincronizar el Set persistente con el DOM actual
    container.querySelectorAll('.enrollment-checkbox').forEach(cb => {
        if (cb.checked) persistentCheckedIds.add(cb.value);
        else persistentCheckedIds.delete(cb.value);
    });

    // ✅ PASO 2: OBTENER DATOS ACTUALES
    const session = await apiCall('/api/session/current');
    let inscritosIds = [];
    if (session?.active && session?.session?.id) {
        const raceDrivers = await apiCall(`/api/race/drivers/${session.session.id}`);
        inscritosIds = raceDrivers ? raceDrivers.map(d => d.driver_id) : [];
    }

    // ✅ PASO 3: FILTRAR POR BÚSQUEDA
    let filtered = allDriversData;
    if (searchTerm && searchTerm.trim() !== '') {
        const term = searchTerm.toLowerCase().trim();
        filtered = allDriversData.filter(d =>
            (d.name || '').toLowerCase().includes(term) ||
            (d.lastname || '').toLowerCase().includes(term) ||
            (d.email || '').toLowerCase().includes(term) ||
            (d.carnet || '').toLowerCase().includes(term) ||
            (d.phone || '').toLowerCase().includes(term) ||
            String(d.transponder_id || '').includes(term)
        );
    }

    // Limpiar del Set persistente pilotos que ya fueron inscritos
    for (const id of persistentCheckedIds) {
        if (inscritosIds.includes(parseInt(id))) persistentCheckedIds.delete(id);
    }

    // PASO 4: Solo mostrar no inscritos
    const disponibles = filtered.filter(d => !inscritosIds.includes(d.id));

    if (disponibles.length === 0) {
        container.innerHTML = '<span style="font-size:0.7rem;color:#888;">No hay pilotos disponibles</span>';
        return;
    }

    container.innerHTML = disponibles.map(d => {
        const photo = d.photo && d.photo !== 'default-avatar.png'
            ? `/static/uploads/drivers/${d.photo}`
            : '/static/pilotcircle1.png';

        const wasChecked = persistentCheckedIds.has(String(d.id));
        const checked = wasChecked ? ' checked' : '';

        const kart = d.transponder_kart_id || '';
        const hasTransponder = d.transponder_id && d.transponder_id > 0;
        const disabled = hasTransponder ? '' : 'disabled';
        const tStyle = hasTransponder ? 'color:#ffd700;' : 'color:#e5484d;';
        const tText = hasTransponder ? d.transponder_id : 'SIN TRANSPONDER ⛔';

        return `<label style="display:flex;align-items:center;gap:0.35rem;padding:0.25rem 0.3rem;cursor:pointer;font-size:0.72rem;border-bottom:1px solid #1a1e26;${hasTransponder ? '' : 'opacity:0.5;'}">
            <input type="checkbox" value="${d.id}" class="enrollment-checkbox" data-transponder="${d.transponder_id || d.id}" ${checked} ${disabled} style="width:14px;height:14px;flex-shrink:0;">
            <img src="${photo}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.src='/static/pilotcircle1.png'">
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.name} ${d.lastname || ''}</span>
            ${kart ? `<span style="color:#00AAE4;font-size:0.6rem;flex-shrink:0;font-weight:bold;">${kart}</span>` : ''}
            <span style="${tStyle}font-size:0.62rem;flex-shrink:0;font-weight:bold;">${tText}</span>
        </label>`;
    }).join('');
}

window.deleteDriver = async (id) => {
    showModal('Eliminar Piloto', '¿Eliminar este piloto?', async () => {
        await apiCall(`/api/drivers/${id}`, { method: 'DELETE' });
        loadDrivers();
        loadTransponders();
    });
};

window.editDriverMinimal = (id, name, lastname, transponder, email, carnet, phone) => {
    document.getElementById('driverName').value = name;
    document.getElementById('driverLastname').value = lastname;
    const transpSel = document.getElementById('driverTransponder');
    if (transpSel) transpSel.value = transponder || '';
    else document.getElementById('driverTransponder').value = transponder || '';
    document.getElementById('driverEmail').value = email || '';
    document.getElementById('driverCarnet').value = carnet || '';
    document.getElementById('driverPhone').value = phone || '';
    document.getElementById('driverAge').value = '';
    document.getElementById('driverPhotoFile').value = '';
    document.getElementById('driverPhotoPreview').src = '/static/pilotcircle1.png';
    editDriverInner(id, name, lastname, transponder, email, carnet, phone);
};

window.editDriver = (id, name, lastname, transponder) => {
    editDriverMinimal(id, name, lastname, transponder, '', '', '');
};


window.openDriverEditModal = async (driver) => {
    const id = driver.id;
    const name = driver.name || '';
    const lastname = driver.lastname || '';
    const transponder = driver.transponder_id || '';
    const email = driver.email || '';
    const carnet = driver.carnet || '';
    const phone = driver.phone || '';
    const photo = driver.photo || '';
    const age = driver.age || '';

    // ✅ CORREGIDO: URL correcta para la foto
    const photoSrc = photo && photo !== 'default-avatar.png'
        ? `/static/uploads/drivers/${photo}`
        : '/static/default-avatar.png';

    const inp = 'padding:0.55rem;background:#0f1117;border:1px solid #2a2f3a;border-radius:8px;color:white;font-size:0.82rem;width:100%;box-sizing:border-box;';

    const modalHTML = `<div style="text-align:center;margin-bottom:1.2rem;padding-top:0.3rem;">
            <img id="_mp" src="${photoSrc}" 
                 style="width:90px;height:90px;border-radius:50%;object-fit:cover;border:3px solid #ffd700;cursor:pointer;display:block;margin:0 auto;"
                 onclick="document.getElementById('_mf').click()" title="Clic para cambiar foto">
            <input type="file" id="_mf" accept="image/*" style="display:none;" onchange="window._previewModalPhoto()">
            <p style="font-size:0.65rem;color:#888;margin-top:0.3rem;">Clic en el círculo para cambiar foto</p>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem 0.8rem;">
            <div style="grid-column:1/-1;">
                <label style="font-size:0.7rem;color:#a4adbc;">Nombre <span style="color:#e5484d;">*</span></label>
                <input id="_mn" value="${name.replace(/"/g, '&quot;')}" style="${inp}">
            </div>
            <div>
                <label style="font-size:0.7rem;color:#a4adbc;">Apellido</label>
                <input id="_mln" value="${lastname.replace(/"/g, '&quot;')}" style="${inp}">
            </div>
            <div>
                <label style="font-size:0.7rem;color:#a4adbc;">Carnet <span style="color:#e5484d;">*</span></label>
                <input id="_mc" value="${carnet.replace(/"/g, '&quot;')}" style="${inp}">
            </div>
            <div>
                <label style="font-size:0.7rem;color:#a4adbc;">Transponder</label>
                <select id="_mt" style="${inp}">
                    <option value="">-- Sin Transponder --</option>
                </select>
            </div>
            <div>
                <label style="font-size:0.7rem;color:#a4adbc;">Edad</label>
                <input id="_ma" type="number" value="${age}" style="${inp}" min="5" max="99">
            </div>
            <div>
                <label style="font-size:0.7rem;color:#a4adbc;">Email</label>
                <input id="_me" type="email" value="${email.replace(/"/g, '&quot;')}" style="${inp}">
            </div>
            <div>
                <label style="font-size:0.7rem;color:#a4adbc;">Teléfono</label>
                <input id="_mph" value="${phone.replace(/"/g, '&quot;')}" style="${inp}">
            </div>
        </div>`;

    // Poner el HTML en el modal
    document.getElementById('modalMessage').innerHTML = modalHTML;
    document.getElementById('modalTitle').innerText = 'Editar Piloto';
    document.getElementById('modalConfirm').innerText = 'Guardar Cambios';
    document.getElementById('modal').style.display = 'flex';

    // Guardar callback para el botón confirmar
    window._pendingEditSave = async () => {
        const photoFile = document.getElementById('_mf')?.files?.[0];
        let photoData = null;
        if (photoFile) {
            photoData = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(photoFile);
            });
        }
        const transpVal = document.getElementById('_mt')?.value;
        const data = {
            name: document.getElementById('_mn').value,
            lastname: document.getElementById('_mln').value,
            transponder_id: transpVal ? parseInt(transpVal) : null,
            email: document.getElementById('_me').value,
            carnet: document.getElementById('_mc').value,
            phone: document.getElementById('_mph').value,
            age: document.getElementById('_ma').value || null,
            photo: photoData || undefined
        };
        const res = await apiCall(`/api/drivers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        if (res?.success) {
            showToast('✅', 'Piloto actualizado', 'success');
            loadDrivers();
            loadTranspondersIntoSelect();
            // ✅ Recargar la foto en la vista
            if (photoFile) {
                await uploadDriverPhoto(id, photoFile);
            }
        } else {
            showToast('❌', res?.error || 'Error al actualizar piloto', 'error');
        }
    };
    pendingAction = window._pendingEditSave;

    // Cargar transponders en el select del modal
    setTimeout(async () => {
        const allTransponders = await apiCall('/api/transponders/all');
        const drivers = allDriversData.length ? allDriversData : (await apiCall('/api/drivers'));
        const assignedMap = {};
        drivers.forEach(d => {
            if (d.transponder_id && d.transponder_id != transponder) {
                assignedMap[d.transponder_id] = d;
            }
        });
        const sel = document.getElementById('_mt');
        if (sel && allTransponders) {
            sel.innerHTML = '<option value="">-- Sin Transponder --</option>';
            for (const t of allTransponders) {
                const assigned = assignedMap[t.id];
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${t.id}${t.kart_id ? ' - ' + t.kart_id : ''}`;
                if (String(t.id) === String(transponder)) opt.selected = true;
                if (assigned) {
                    opt.style.color = '#e5484d';
                    opt.textContent += ` 🔒 ${assigned.name}`;
                }
                sel.appendChild(opt);
            }
        }
    }, 200);
};

// Photo preview for modal
window._previewModalPhoto = () => {
    const file = document.getElementById('_mf')?.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('_mp').src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
};

function editDriverInner(id, name, lastname, transponder, email, carnet, phone) {
    document.getElementById('driverName').value = name;
    document.getElementById('driverLastname').value = lastname;
    const tSel2 = document.getElementById('driverTransponder');
    if (tSel2 && tSel2.tagName === 'SELECT') {
        tSel2.value = transponder || '';
    }
    document.getElementById('driverEmail').value = email || '';
    document.getElementById('driverCarnet').value = carnet || '';
    document.getElementById('driverPhone').value = phone || '';
    document.getElementById('driverAge').value = '';

    const saveBtn = document.getElementById('saveDriverBtn');
    const originalText = saveBtn.innerText;
    saveBtn.innerText = '💾 ACTUALIZAR PILOTO';
    saveBtn.className = 'btn btn-warning';
    saveBtn.style.width = '100%';

    saveBtn.onclick = async () => {
        const photoFile = document.getElementById('driverPhotoFile')?.files?.[0];
        let photoData = null;
        if (photoFile) {
            photoData = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(photoFile);
            });
        }
        const data = {
            name: document.getElementById('driverName').value,
            lastname: document.getElementById('driverLastname').value,
            transponder_id: (() => { const v = document.getElementById('driverTransponder'); return v && v.value ? parseInt(v.value) : null; })(),
            email: document.getElementById('driverEmail')?.value || '',
            carnet: document.getElementById('driverCarnet')?.value || '',
            phone: document.getElementById('driverPhone')?.value || '',
            age: document.getElementById('driverAge')?.value || null,
            photo: photoData
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
            saveBtn.onclick = createDriverHandler;
            document.getElementById('driverName').value = '';
            document.getElementById('driverLastname').value = '';
            const tSel = document.getElementById('driverTransponder');
            if (tSel) tSel.value = '';
            document.getElementById('driverEmail').value = '';
            document.getElementById('driverCarnet').value = '';
            document.getElementById('driverPhone').value = '';
            document.getElementById('driverAge').value = '';
            document.getElementById('driverPhotoFile').value = '';
            document.getElementById('driverPhotoPreview').src = '/static/pilotcircle1.png';
            document.getElementById('extraDriverFields').style.display = 'none';
            document.getElementById('toggleExtraFieldsBtn').innerHTML = '▼ Más campos';
            loadDrivers();
        }
    };
}

const createDriverHandler = async () => {
    const name = document.getElementById('driverName').value.trim();
    const carnet = document.getElementById('driverCarnet').value.trim();
    if (!name) { showToast('⚠️', 'El nombre es obligatorio', 'warning'); return; }
    if (!carnet) { showToast('⚠️', 'El carnet es obligatorio', 'warning'); return; }

    const transponderSel = document.getElementById('driverTransponder');
    const transponderVal = transponderSel?.value || '';

    // Datos del piloto (sin foto)
    const data = {
        transponder_id: transponderVal ? parseInt(transponderVal) : null,
        name: name,
        lastname: document.getElementById('driverLastname').value,
        email: document.getElementById('driverEmail')?.value || '',
        carnet: carnet,
        phone: document.getElementById('driverPhone')?.value || '',
        age: document.getElementById('driverAge')?.value || null
    };

    showLoader('Guardando piloto...');
    const res = await apiCall('/api/drivers', { method: 'POST', body: JSON.stringify(data) });
    hideLoader();

    if (res?.success) {
        const driverId = res.driver_id;

        // ✅ SUBIR FOTO SI EXISTE (usando multipart/form-data)
        const photoFile = document.getElementById('driverPhotoFile')?.files?.[0];
        if (photoFile) {
            await uploadDriverPhoto(driverId, photoFile);
        }

        // Limpiar formulario
        if (transponderSel) transponderSel.value = '';
        document.getElementById('driverName').value = '';
        document.getElementById('driverLastname').value = '';
        document.getElementById('driverEmail').value = '';
        document.getElementById('driverCarnet').value = '';
        document.getElementById('driverPhone').value = '';
        document.getElementById('driverAge').value = '';
        document.getElementById('driverPhotoFile').value = '';
        document.getElementById('driverPhotoPreview').src = '/static/pilotcircle1.png';
        document.getElementById('extraDriverFields').style.display = 'none';
        document.getElementById('toggleExtraFieldsBtn').innerHTML = '▼ Más campos';

        loadDrivers();
        loadTransponders();
        loadTranspondersIntoSelect();
        showToast('✅', 'Piloto registrado correctamente', 'success');
    }
};

// ✅ NUEVA FUNCIÓN: Subir foto de piloto (multipart/form-data)
async function uploadDriverPhoto(driverId, file) {
    const formData = new FormData();
    formData.append('photo', file);

    try {
        showLoader('Subiendo foto...');
        const token = sessionToken || localStorage.getItem('chronit_session_token');
        const response = await fetch(`/api/drivers/${driverId}/photo`, {
            method: 'POST',
            headers: {
                'X-Session-Token': token || ''
            },
            body: formData  // ← multipart/form-data
        });

        const result = await response.json();
        hideLoader();

        if (result.success) {
            console.log('✅ Foto subida:', result.photo_url);
            showToast('✅', 'Foto subida correctamente', 'success');
            return true;
        } else {
            showToast('❌', result.error || 'Error al subir foto', 'error');
            return false;
        }
    } catch (e) {
        hideLoader();
        console.error('Error subiendo foto:', e);
        showToast('❌', 'Error al subir la foto', 'error');
        return false;
    }
}

// ✅ NUEVA FUNCIÓN: Eliminar foto de piloto
async function deleteDriverPhoto(driverId) {
    try {
        showLoader('Eliminando foto...');
        const token = sessionToken || localStorage.getItem('chronit_session_token');
        const response = await fetch(`/api/drivers/${driverId}/photo`, {
            method: 'DELETE',
            headers: {
                'X-Session-Token': token || ''
            }
        });

        const result = await response.json();
        hideLoader();

        if (result.success) {
            showToast('✅', 'Foto eliminada', 'success');
            loadDrivers();
            return true;
        } else {
            showToast('❌', result.error || 'Error al eliminar foto', 'error');
            return false;
        }
    } catch (e) {
        hideLoader();
        console.error('Error eliminando foto:', e);
        showToast('❌', 'Error al eliminar la foto', 'error');
        return false;
    }
}

document.getElementById('saveDriverBtn').onclick = createDriverHandler;

// Photo preview
document.getElementById('driverPhotoFile')?.addEventListener('change', function () {
    const file = this.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('driverPhotoPreview').src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
});

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
    const checkboxes = document.querySelectorAll('.enrollment-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('⚠️', 'Selecciona al menos un piloto', 'warning');
        return;
    }

    const session = await apiCall('/api/session/current');
    if (!session?.active || session?.session?.status === 'completed') {
        showToast('⚠️', 'No hay carrera activa o ya finalizó', 'warning');
        return;
    }

    // ✅ OBTENER PILOTOS ACTUALES
    const currentDrivers = await apiCall(`/api/race/drivers/${session.session.id}`);
    const currentCount = currentDrivers?.length || 0;
    const newCount = checkboxes.length;
    const total = currentCount + newCount;

    // ✅ Si está dentro del límite recomendado, inscribir directamente
    if (total <= MAX_RECOMMENDED_PILOTS) {
        await inscribirPilotos(checkboxes, session);
        return;
    }

    // ✅ Mostrar modal de advertencia
    showPilotCapacityWarning(currentCount, newCount, async () => {
        await inscribirPilotos(checkboxes, session);
    });
};

// ✅ FUNCIÓN AUXILIAR PARA INSCRIBIR
async function inscribirPilotos(checkboxes, session) {
    showLoader(`Inscribiendo ${checkboxes.length} piloto(s)...`);
    let inscritos = 0;
    for (const cb of checkboxes) {
        const driverId = parseInt(cb.value);
        const transponderId = cb.dataset.transponder && cb.dataset.transponder !== 'undefined' ? parseInt(cb.dataset.transponder) : driverId;
        const res = await apiCall('/api/race/add', {
            method: 'POST',
            body: JSON.stringify({
                session_id: session.session.id,
                driver_id: driverId,
                transponder_id: transponderId
            })
        });
        if (res?.success) inscritos++;
    }
    hideLoader();
    showToast('✅', `${inscritos} piloto(s) inscrito(s)`, 'success');
    persistentCheckedIds.clear();
    loadDrivers();
    loadLiveData();
}

// ============================================================
// CONFIGURACIÓN DE VENTANAS DE RESULTADOS
// ============================================================

async function loadWinnerConfig() {
    try {
        const token = sessionToken || localStorage.getItem('chronit_session_token');
        if (!token) {
            winnerConfig = { autoShow: true, showLimit: 1, displayTime: 15 };
            applyWinnerConfigUI();
            return;
        }

        const response = await fetch('/api/user/preferences', {
            headers: { 'X-Session-Token': token }
        });
        const data = await response.json();

        if (data.success && data.preferences) {
            winnerConfig = {
                autoShow: data.preferences.winner_auto_show !== 'false',
                showLimit: parseInt(data.preferences.winner_show_limit) || 1,
                displayTime: parseInt(data.preferences.winner_display_time) || 15
            };
        }
        applyWinnerConfigUI();
    } catch (e) {
        console.warn('Error cargando configuración:', e);
        winnerConfig = { autoShow: true, showLimit: 1, displayTime: 15 };
        applyWinnerConfigUI();
    }
}

function applyWinnerConfigUI() {
    const toggle = document.getElementById('winnerAutoShowToggle');
    const status = document.getElementById('winnerAutoShowStatus');
    const limitSlider = document.getElementById('winnerShowLimitSlider');
    const limitValue = document.getElementById('winnerShowLimitValue');
    const timeSlider = document.getElementById('winnerDisplayTimeSlider');
    const timeValue = document.getElementById('winnerDisplayTimeValue');

    if (toggle) {
        toggle.checked = winnerConfig.autoShow;
        if (status) {
            status.innerText = winnerConfig.autoShow ? 'Activado' : 'Desactivado';
            status.style.color = winnerConfig.autoShow ? '#34d399' : '#ef7a86';
        }
    }
    if (limitSlider) limitSlider.value = winnerConfig.showLimit;
    if (limitValue) limitValue.value = winnerConfig.showLimit;
    if (timeSlider) timeSlider.value = winnerConfig.displayTime;
    if (timeValue) timeValue.value = winnerConfig.displayTime;

    // ✅ Actualizar preview
    const previewTimer = document.getElementById('winnerPreviewTimer');
    if (previewTimer) {
        previewTimer.textContent = `${winnerConfig.displayTime}s`;
    }
}


async function saveWinnerConfig() {
    const toggle = document.getElementById('winnerAutoShowToggle');
    const limitValue = document.getElementById('winnerShowLimitValue');
    const timeValue = document.getElementById('winnerDisplayTimeValue');

    const config = {
        winner_auto_show: toggle ? toggle.checked : true,
        winner_show_limit: parseInt(limitValue?.value) || 1,
        winner_display_time: parseInt(timeValue?.value) || 15
    };

    console.log('[CONFIG] Guardando:', config);

    const statusSpan = document.getElementById('winnerConfigStatus');
    if (statusSpan) {
        statusSpan.innerText = '⏳ Guardando...';
        statusSpan.style.color = '#ffaa00';
    }

    try {
        const token = sessionToken || localStorage.getItem('chronit_session_token');
        if (!token) {
            showToast('⚠️', 'Inicia sesión para guardar configuración', 'warning');
            return;
        }

        const response = await fetch('/api/user/preferences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': token
            },
            body: JSON.stringify(config)
        });
        const data = await response.json();

        if (data.success) {
            winnerConfig = config;

            if (winnerConfig.showLimit > 0) {
                winnerShowCount = 0;
            }

            if (statusSpan) {
                statusSpan.innerText = '✅ Guardado';
                statusSpan.style.color = '#34d399';
                setTimeout(() => { statusSpan.innerText = 'Listo'; }, 3000);
            }

            // ✅ APLICAR CAMBIOS EN LA UI SIN RECARGAR
            applyWinnerConfigUI();

            showToast('✅', 'Configuración guardada correctamente', 'success');

        } else {
            if (statusSpan) {
                statusSpan.innerText = '❌ Error';
                statusSpan.style.color = '#ef7a86';
            }
            showToast('❌', data.error || 'Error al guardar', 'error');
        }
    } catch (e) {
        console.error('Error guardando configuración:', e);
        if (statusSpan) {
            statusSpan.innerText = '❌ Error';
            statusSpan.style.color = '#ef7a86';
        }
        showToast('❌', 'Error al conectar con el servidor', 'error');
    }
}

function updateConfigHints() {
    const limitSlider = document.getElementById('winnerShowLimitSlider');
    const limitValue = document.getElementById('winnerShowLimitValue');
    const timeSlider = document.getElementById('winnerDisplayTimeSlider');
    const timeValue = document.getElementById('winnerDisplayTimeValue');
    const previewTimer = document.getElementById('winnerPreviewTimer');
    const autoToggle = document.getElementById('winnerAutoShowToggle');
    const autoStatus = document.getElementById('winnerAutoShowStatus');

    // Actualizar límite
    if (limitSlider) limitSlider.value = winnerConfig.showLimit;
    if (limitValue) limitValue.value = winnerConfig.showLimit;

    // Actualizar tiempo
    if (timeSlider) timeSlider.value = winnerConfig.displayTime;
    if (timeValue) timeValue.value = winnerConfig.displayTime;

    // Actualizar preview
    if (previewTimer) {
        previewTimer.textContent = `${winnerConfig.displayTime}s`;
    }

    // Actualizar toggle
    if (autoToggle) {
        autoToggle.checked = winnerConfig.autoShow;
        if (autoStatus) {
            autoStatus.innerText = winnerConfig.autoShow ? 'Activado' : 'Desactivado';
            autoStatus.style.color = winnerConfig.autoShow ? '#34d399' : '#ef7a86';
        }
    }

    // Actualizar hints
    const limitHint = document.querySelector('#winnerShowLimitSlider')?.closest('.compact-config-row')?.querySelector('.hint');
    if (limitHint) {
        const val = winnerConfig.showLimit;
        if (val == 0) limitHint.innerText = '♾️ Ilimitado - Se mostrará siempre';
        else if (val == 1) limitHint.innerText = '🔄 Se mostrará 1 vez por sesión';
        else limitHint.innerText = `🔄 Se mostrará ${val} veces por sesión`;
    }

    const timeHint = document.querySelector('#winnerDisplayTimeSlider')?.closest('.compact-config-row')?.querySelector('.hint');
    if (timeHint) {
        const val = winnerConfig.displayTime;
        if (val <= 10) timeHint.innerText = `⏱️ Se mostrará ${val} segundos (rápido)`;
        else if (val <= 20) timeHint.innerText = `⏱️ Se mostrará ${val} segundos (normal)`;
        else timeHint.innerText = `⏱️ Se mostrará ${val} segundos (largo)`;
    }
}

// Configurar eventos de los controles
function setupWinnerConfigControls() {
    console.log('[CONFIG] Inicializando controles...');

    const limitSlider = document.getElementById('winnerShowLimitSlider');
    const limitValue = document.getElementById('winnerShowLimitValue');
    const timeSlider = document.getElementById('winnerDisplayTimeSlider');
    const timeValue = document.getElementById('winnerDisplayTimeValue');
    const autoToggle = document.getElementById('winnerAutoShowToggle');
    const autoStatus = document.getElementById('winnerAutoShowStatus');
    const saveBtn = document.getElementById('saveWinnerConfigBtn');
    const previewTimer = document.getElementById('winnerPreviewTimer');

    // ✅ VERIFICAR QUE LOS ELEMENTOS EXISTAN
    console.log('[CONFIG] limitSlider:', limitSlider);
    console.log('[CONFIG] limitValue:', limitValue);
    console.log('[CONFIG] timeSlider:', timeSlider);
    console.log('[CONFIG] timeValue:', timeValue);

    // ✅ SINCRONIZAR: Slider → Input (Límite)
    if (limitSlider && limitValue) {
        limitSlider.oninput = function () {
            const val = parseInt(this.value);
            limitValue.value = val;
            updateHint('limit', val);
            updatePreview(val);
        };

        limitValue.onchange = function () {
            let val = parseInt(this.value);
            if (isNaN(val)) val = 1;
            if (val < 0) val = 0;
            if (val > 10) val = 10;
            this.value = val;
            limitSlider.value = val;
            updateHint('limit', val);
            updatePreview(val);
        };
    }

    // ✅ SINCRONIZAR: Slider → Input (Tiempo)
    if (timeSlider && timeValue) {
        timeSlider.oninput = function () {
            const val = parseInt(this.value);
            timeValue.value = val;
            updateHint('time', val);
            updatePreview(val);
        };

        timeValue.onchange = function () {
            let val = parseInt(this.value);
            if (isNaN(val)) val = 15;
            if (val < 5) val = 5;
            if (val > 60) val = 60;
            this.value = val;
            timeSlider.value = val;
            updateHint('time', val);
            updatePreview(val);
        };
    }

    // ✅ FUNCIÓN: Actualizar hints
    function updateHint(type, value) {
        if (type === 'limit') {
            const hint = limitSlider?.closest('.compact-config-row')?.querySelector('.hint');
            if (hint) {
                if (value == 0) hint.innerText = '♾️ Ilimitado - Se mostrará siempre';
                else if (value == 1) hint.innerText = '🔄 Se mostrará 1 vez por sesión';
                else hint.innerText = `🔄 Se mostrará ${value} veces por sesión`;
            }
        } else if (type === 'time') {
            const hint = timeSlider?.closest('.compact-config-row')?.querySelector('.hint');
            if (hint) {
                hint.innerText = `⏱️ Se mostrará ${value} segundos`;
            }
        }
    }

    // ✅ FUNCIÓN: Actualizar preview
    function updatePreview(value) {
        if (previewTimer) {
            previewTimer.textContent = `${value}s`;
        }
    }

    // ✅ Toggle
    if (autoToggle && autoStatus) {
        autoToggle.onchange = function () {
            autoStatus.innerText = this.checked ? 'Activado' : 'Desactivado';
            autoStatus.style.color = this.checked ? '#34d399' : '#ef7a86';
        };
    }

    // ✅ Botón Guardar
    if (saveBtn) {
        saveBtn.onclick = saveWinnerConfig;
    }

    // ✅ INICIALIZAR valores al cargar
    if (limitSlider) {
        const val = parseInt(limitSlider.value) || 1;
        if (limitValue) limitValue.value = val;
        updateHint('limit', val);
        updatePreview(val);
    }
    if (timeSlider) {
        const val = parseInt(timeSlider.value) || 15;
        if (timeValue) timeValue.value = val;
        updateHint('time', val);
        updatePreview(val);
    }
    if (autoToggle && autoStatus) {
        autoStatus.innerText = autoToggle.checked ? 'Activado' : 'Desactivado';
        autoStatus.style.color = autoToggle.checked ? '#34d399' : '#ef7a86';
    }

    console.log('[CONFIG] Controles inicializados correctamente');
}

// ============================================================
// FUNCIONES DE CONFIGURACIÓN DE VENTANAS
// ============================================================

function shouldShowWinner() {
    // ✅ Verificar autoShow (solo para automático)
    if (!winnerConfig.autoShow) {
        console.log('[WINNER] AutoShow desactivado');
        return false;
    }

    // ✅ Verificar límite (0 = ilimitado)
    if (winnerConfig.showLimit > 0 && winnerShowCount >= winnerConfig.showLimit) {
        console.log(`[WINNER] Límite alcanzado: ${winnerShowCount}/${winnerConfig.showLimit}`);
        return false;
    }

    return true;
}

// ✅ NUEVA FUNCIÓN: Para mostrar manualmente (SIEMPRE muestra)
function shouldShowWinnerManual() {
    // ✅ Solo verificar autoShow, NO el límite
    if (!winnerConfig.autoShow) {
        console.log('[WINNER MANUAL] AutoShow desactivado, pero mostrando por botón');
        // ✅ Aún así mostramos, porque el usuario presionó el botón
        return true;
    }
    return true;
}

function incrementWinnerShowCount() {
    winnerShowCount++;
    console.log(`[WINNER] Mostrado ${winnerShowCount}/${winnerConfig.showLimit} veces`);
}


// ═══════════════════════════════════════════
// NUEVOS HANDLERS DE PILOTOS
// ═══════════════════════════════════════════

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

let editingTransponderData = null;

window.editTransponder = async (id) => {
    const transponder = allTranspondersCache.find(t => t.id === id);
    if (!transponder) {
        showToast('❌', 'Transponder no encontrado.', 'error');
        return;
    }

    editingTransponderData = { oldId: id };

    document.getElementById('editModalTransponderId').value = transponder.id;
    document.getElementById('editModalKartId').value = transponder.kart_id || '';
    document.getElementById('editModalDesc').value = transponder.description || '';
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

        if (newId !== oldId) {
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

    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });
}

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

document.getElementById('createNewRaceBtn').onclick = () => {
    const name = document.getElementById('newCircuitName').value;
    const laps = document.getElementById('newLapsLimit').value;
    const raceMode = document.getElementById('newRaceMode') ? document.getElementById('newRaceMode').value : 'position';
    const normalizedMode = normalizeRaceMode(raceMode);

    let timeLimitSeconds = 0;
    let timeLimitMinutes = 0;

    if (raceMode === 'classification') {
        timeLimitMinutes = parseInt(document.getElementById('timeLimitMinutes')?.value || 5);
        timeLimitSeconds = timeLimitMinutes * 60;
    } else if (raceMode === 'endurance') {
        timeLimitMinutes = parseInt(document.getElementById('enduranceMinutes')?.value || 10);
        timeLimitSeconds = timeLimitMinutes * 60;
    }

    if (!name) {
        showToast('⚠️', 'Ingresa un nombre para la carrera', 'warning');
        return;
    }

    // ⭐⭐⭐ CONSTRUIR MENSAJE SEGÚN EL MODO (SIN MOSTRAR VUELTAS SI NO CORRESPONDE) ⭐⭐⭐
    let mensaje = `¿Crear carrera "${name}"`;

    if (normalizedMode === 'endurance') {
        mensaje += ` con duración de ${timeLimitMinutes} minutos?`;
        mensaje += `\n\n🏆 Gana el piloto con MÁS vueltas completadas.`;
        mensaje += `\n📊 Desempate: menor tiempo acumulado.`;
        mensaje += `\n⏱️ La carrera terminará automáticamente al cumplirse el tiempo.`;
    } else if (normalizedMode === 'classification') {
        mensaje += ` con duración de ${timeLimitMinutes} minutos?`;
        mensaje += `\n\n🏆 Gana el piloto con la MEJOR vuelta.`;
        mensaje += `\n⏱️ Los que no tengan vuelta quedan desclasificados.`;
        mensaje += `\n⏱️ La carrera terminará automáticamente al cumplirse el tiempo.`;
    } else if (normalizedMode === 'time_attack') {
        mensaje += ` con ${laps} vueltas?`;
        mensaje += `\n\n🏆 Gana el piloto con MENOR tiempo acumulado.`;
        mensaje += `\n⚠️ Deben completar TODAS las vueltas.`;
    } else {
        // POSITION RACE
        mensaje += ` con ${laps} vueltas?`;
        mensaje += `\n\n🏆 Gana el primero en cruzar la meta.`;
    }

    showModal('Nueva Carrera', mensaje, async () => {
        // Limpiar estado de tiempo límite
        const timerEl = document.getElementById('timeRemainingDisplay');
        if (timerEl) {
            timerEl.style.display = 'none';
            timerEl.innerText = '⏱️ Tiempo restante: --';
            timerEl.style.color = '#ffd700';
        }

        const liveTimer = document.getElementById('liveTotalTime');
        if (liveTimer) {
            liveTimer.innerText = '00:00.000';
            liveTimer.classList.remove('status-timeout', 'status-completed');
            liveTimer.classList.add('status-pending');
        }

        // Limpiar el box de tiempo restante
        const timerBox = document.getElementById('timeRemainingBox');



        if (timerBox) {
            timerBox.style.display = 'none';
            timerBox.innerText = '00:00.000';
            timerBox.className = 'race-timer-box time-remaining-status-pending';
        }

        TIME_LIMIT_ACTIVE = false;
        TIME_LIMIT_END = 0;
        raceTimerState.status = 'pending';
        raceTimerState.seconds = 0;

        try {
            await apiCall('/api/race/time-limit-status', {
                method: 'POST',
                body: JSON.stringify({
                    time_limit_active: false,
                    time_limit_end: 0,
                    completed: false
                })
            });
        } catch (e) { console.warn('Error reiniciando tiempo:', e); }

        showLoader('Creando nueva carrera...');

        try {
            const res = await apiCall('/api/race/create-new', {
                method: 'POST',
                body: JSON.stringify({
                    next_race_name: name,
                    next_race_laps: parseInt(laps) || 10,
                    next_race_mode: raceMode,
                    time_limit_seconds: timeLimitSeconds
                })
            });

            if (res?.success) {
                showToast('✅', `Carrera "${name}" creada`, 'success');
                await loadLiveData();
                await updateTimeRemaining();
                await loadDrivers();
                const enrollment = document.getElementById('enrollmentCheckboxList');
                if (enrollment) enrollment.innerHTML = '<span style="font-size:0.7rem;color:#888;">Cargando pilotos...</span>';
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
                // ⭐⭐⭐ REINICIAR ESTADO DE TIEMPO LÍMITE ⭐⭐⭐
                const timerEl = document.getElementById('timeRemainingDisplay');
                if (timerEl) {
                    timerEl.style.display = 'none';
                    timerEl.innerText = '⏱️ Tiempo restante: --';
                    timerEl.style.color = '#ffd700';
                }

                const liveTimer = document.getElementById('liveTotalTime');
                if (liveTimer) {
                    liveTimer.innerText = '00:00.000';
                    liveTimer.classList.remove('status-timeout', 'status-completed');
                    liveTimer.classList.add('status-pending');
                }

                TIME_LIMIT_ACTIVE = false;
                TIME_LIMIT_END = 0;
                raceTimerState.status = 'pending';
                raceTimerState.seconds = 0;

                try {
                    await apiCall('/api/race/time-limit-status', {
                        method: 'POST',
                        body: JSON.stringify({
                            time_limit_active: false,
                            time_limit_end: 0,
                            completed: false
                        })
                    });
                } catch (e) { console.warn('Error reiniciando tiempo:', e); }

                showToast('✅', 'Tablero reseteado', 'success');
                await new Promise(r => setTimeout(r, 500));
                await loadLiveData();
                renderRaceClock();

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

        const res = await apiCall('/api/race/clear-all', { method: 'POST' });

        hideLoader();

        if (res?.success) {
            showToast('✅', 'Reinicio total completado. Se ha creado un respaldo.', 'success');
            await loadLiveData();
        } else {
            showToast('❌', res?.error || 'No se pudo ejecutar el reinicio', 'error');
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
    overlay.style.display = 'flex';

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
    const session = await apiCall('/api/session/current');
    let totalDrivers = session?.leaderboard?.length || 0;

    // Si el leaderboard está vacío, intentar desde race_drivers
    if (totalDrivers === 0 && session?.session?.id) {
        const raceDrivers = await apiCall(`/api/race/drivers/${session.session.id}`);
        totalDrivers = raceDrivers?.length || 0;
    }

    if (totalDrivers === 0) {
        showModal('🚫 SIN PILOTOS', 'No hay pilotos inscritos en la carrera.', () => { });
        return;
    }

    const simulationToggle = document.getElementById('simulationModeToggle');
    const isSimulationActive = simulationToggle ? simulationToggle.checked : false;

    if (!isSimulationActive) {
        try {
            const decoderStatus = await apiCall('/api/decoder/status');
            if (!decoderStatus?.connected) {
                showModal('⚠️ DECODER NO CONECTADO',
                    'El hardware ESL-400 no está conectado.\n 🚫 No se pudo iniciar la carrera.\n\n'
                    + 'Para iniciar la carrera:\n'
                    + '1. Conecte el hardware ESL-400.\n'
                    + '2. Cree una carrera.\n'
                    + '3. Inscriba a los pilotos.\n'
                    + '4. Inicie la carrera.\n\n'
                    + 'Para pruebas en modo simulación:\n'
                    + '1. Inicie sesión en modo desarrollador.\n'
                    + '2. Activa el interruptor "Simulación".\n'
                    + '3. Inicie la carrera.',
                    () => { });
                return;
            }
        } catch (e) {
            console.error("Error verificando decoder:", e);
            showModal('⚠️ ERROR DE COMUNICACIÓN',
                'No se pudo verificar el estado del decoder.\n\n'
                + 'Asegúrate de que el hardware esté conectado o activa el modo simulación.',
                () => { });
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
        loadLiveData();
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

            // Ocultar box de tiempo restante
            const timerBox = document.getElementById('timeRemainingBox');
            if (timerBox) {
                timerBox.style.display = 'none';
                timerBox.innerText = '00:00.000';
                timerBox.className = 'race-timer-box status-pending';
            }

            // Reiniciar estado global
            TIME_LIMIT_ACTIVE = false;
            TIME_LIMIT_END = 0;
            raceTimerState.status = 'pending';
            raceTimerState.seconds = 0;

            // Recargar datos
            await loadLiveData();
            await updateTimeRemaining();
            renderRaceClock();

            showToast('🔄', 'Carrera reiniciada correctamente', 'info');

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

let winnerModalShown = false;

function winnerDetailsText(driver) {
    if (!driver) return '--';
    const kart = driver.kart_id || '--';
    const transponder = driver.transponder_id || '--';
    const mode = normalizeRaceMode(currentRaceMode);
    const bestLap = driver.best_lap != null ? `${Number(driver.best_lap).toFixed(3)} s` : '--';

    let total = '--';
    let realTotal = '--';

    if (driver.total_time != null) {
        total = formatRaceClock(driver.total_time);
    } else if (driver.finish_total_seconds != null) {
        total = formatRaceClock(driver.finish_total_seconds);
    } else if (driver.first_detection && driver.last_detection) {
        const first = new Date(driver.first_detection).getTime();
        const last = new Date(driver.last_detection).getTime();
        if (!isNaN(first) && !isNaN(last) && last > first) {
            total = formatRaceClock((last - first) / 1000);
        }
    }

    if (driver.real_total_time != null) {
        realTotal = formatRaceClock(driver.real_total_time);
    }

    const laps = driver.total_laps != null ? String(driver.total_laps) : '--';

    if (mode === 'time_attack') {
        return `⏱️ TIME ATTACK | Kart ${kart} | ${laps} v | Total ${realTotal} | Mejor ${bestLap}`;
    }
    return `🏁 POSITION RACE | Kart ${kart} | ${laps} v | Total ${total} | Mejor ${bestLap}`;
}

let winnerModalTimer = null;

function showClassificationModal(q1, q2, q3, dnq, manual = false) {

    if (!manual) {

        if (!shouldShowWinner()) {
            console.log('[CLASSIFICATION] Configuración impide mostrar ventana (automático)');
            return;
        }
    } else {

        console.log('[CLASSIFICATION] Mostrando manualmente (ignorando límite)');
    }

    if (classificationModalShown) return;
    classificationModalShown = true;


    if (!manual) {
        incrementWinnerShowCount();
    }

    const formatPilot = (d, idx) => {
        const name = (d.full_name || (d.name || '') + ' ' + (d.lastname || '')).trim();
        const best = d.best_lap ? (d.best_lap.toFixed(3) + 's') : '--';

        const photo = d.photo && d.photo !== 'default-avatar.png'
            ? `/static/uploads/drivers/${d.photo}`
            : '/static/default-avatar.png';

        return `<div style="display:flex;align-items:center;gap:0.6rem;padding:0.3rem 0;font-size:0.78rem;border-bottom:1px solid #1a1e26;">
            <img src="${photo}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:2px solid #ffd700;flex-shrink:0;" onerror="this.src='/static/default-avatar.png'">
            <span style="color:#ffd700;font-weight:bold;min-width:22px;">${idx + 1}.</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
            <span style="color:#ffd700;font-family:monospace;">${best}</span>
        </div>`;
    };

    const groups = [
        { title: 'Q1 🏎️', color: '#ffd700', data: q1 || [] },
        { title: 'Q2 🏁', color: '#c0c0c0', data: q2 || [] },
        { title: 'Q3 ⏱️', color: '#cd7f32', data: q3 || [] },
    ];

    let html = '<div style="text-align:center;margin-bottom:1rem;"><h2 style="color:#ffd700;margin:0;">🏁 CLASIFICACIÓN</h2></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;max-height:50vh;overflow-y:auto;">';

    for (const g of groups) {
        html += `<div style="background:#0f1117;border:1px solid ${g.color};border-radius:10px;padding:0.5rem;">
            <div style="text-align:center;font-weight:bold;font-size:0.85rem;color:${g.color};margin-bottom:0.4rem;">${g.title}</div>`;
        if (g.data.length === 0) {
            html += '<div style="text-align:center;color:#888;font-size:0.7rem;">--</div>';
        } else {
            html += g.data.map((d, i) => formatPilot(d, i)).join('');
        }
        html += '</div>';
    }
    html += '</div>';

    if (dnq && dnq.length > 0) {
        html += '<div style="margin-top:0.8rem;background:#1a0a0a;border:1px solid #e5484d;border-radius:10px;padding:0.5rem;">';
        html += '<div style="text-align:center;font-weight:bold;font-size:0.85rem;color:#e5484d;margin-bottom:0.3rem;">❌ DNQ (Sin vuelta válida)</div>';
        html += dnq.map((d, i) => {
            const photo = d.photo && d.photo !== 'default-avatar.png'
                ? `/static/uploads/drivers/${d.photo}`
                : '/static/default-avatar.png';
            return `<div style="display:flex;align-items:center;gap:0.6rem;padding:0.2rem 0;font-size:0.72rem;border-bottom:1px solid #2a0a0a;">
                <img src="${photo}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;border:1px solid #e5484d;flex-shrink:0;" onerror="this.src='/static/default-avatar.png'">
                <span style="color:#e5484d;">•</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(d.full_name || (d.name || '') + ' ' + (d.lastname || '')).trim()}</span>
                <span style="color:#888;font-size:0.65rem;">${d.total_laps || 0} v</span>
            </div>`;
        }).join('');
        html += '</div>';
    }

    html += '<div style="text-align:center;margin-top:1rem;font-size:0.65rem;color:#888;">Los grupos se dividen en tercios según mejor vuelta</div>';

    document.getElementById('modalMessage').innerHTML = html;
    document.getElementById('modalTitle').innerText = '🏁 CLASIFICACIÓN';
    document.getElementById('modal').style.display = 'flex';
    document.getElementById('modalConfirm').style.display = 'none';
    document.getElementById('modalCancel').innerText = 'Cerrar';

    // ✅ TIMER DE CIERRE AUTOMÁTICO (usando configuración)
    const displayTime = winnerConfig.displayTime || 15;
    if (classificationModalTimer) clearTimeout(classificationModalTimer);
    classificationModalTimer = setTimeout(() => {
        document.getElementById('modal').style.display = 'none';
        classificationModalTimer = null;
        classificationModalShown = false; // ✅ Resetear al cerrar
    }, displayTime * 1000);

    const modal = document.getElementById('modal');
    modal.onclick = function (e) {
        if (e.target === modal) {
            document.getElementById('modal').style.display = 'none';
            if (classificationModalTimer) {
                clearTimeout(classificationModalTimer);
                classificationModalTimer = null;
            }
            classificationModalShown = false; // ✅ Resetear al cerrar
        }
    };

    document.onkeydown = function (e) {
        if (e.key === 'Escape' && document.getElementById('modal').style.display === 'flex') {
            document.getElementById('modal').style.display = 'none';
            if (classificationModalTimer) {
                clearTimeout(classificationModalTimer);
                classificationModalTimer = null;
            }
            classificationModalShown = false; // ✅ Resetear al cerrar
        }
    };
}


function showWinnerModalComplete(winner, second, third, manual = false) {
    // ✅ Si es MANUAL, NO verificar configuración
    if (!manual) {
        if (!shouldShowWinner()) {
            console.log('[WINNER] Configuración impide mostrar ventana (automático)');
            return;
        }
    } else {
        console.log('[WINNER] Mostrando manualmente (ignorando límite)');
    }

    if (winnerModalShown) return;
    winnerModalShown = true;

    if (!manual) {
        incrementWinnerShowCount();
    }

    // ✅ FUNCIÓN PARA CREAR FILA DE PILOTO
    function createPilotRow(pilot, position, medal, borderColor) {
        if (!pilot) return '';

        const photo = pilot.photo && pilot.photo !== 'default-avatar.png'
            ? `/static/uploads/drivers/${pilot.photo}`
            : '/static/default-avatar.png';

        const name = pilot.full_name || pilot.name || '--';
        const details = winnerDetailsText(pilot);

        // Medallas según posición
        const medalEmoji = position === 1 ? '🥇' : position === 2 ? '🥈' : '🥉';
        const title = position === 1 ? 'CAMPEÓN' : position === 2 ? 'SUBCAMPEÓN' : 'TERCER PUESTO';
        const bgColor = position === 1 ? 'rgba(255,215,0,0.15)' : position === 2 ? 'rgba(192,192,192,0.12)' : 'rgba(205,127,50,0.12)';
        const borderColorFinal = position === 1 ? '#ffd700' : position === 2 ? '#c0c0c0' : '#cd7f32';
        const textColor = position === 1 ? '#ffd700' : position === 2 ? '#c0c0c0' : '#cd7f32';

        return `
            <div style="display:flex; align-items:center; gap:1rem; padding:0.8rem 1rem; margin-bottom:0.8rem; background:${bgColor}; border-left:4px solid ${borderColorFinal}; border-radius:8px; flex-wrap:wrap;">
                <img src="${photo}" style="width:55px; height:55px; border-radius:50%; object-fit:cover; border:3px solid ${borderColorFinal}; flex-shrink:0;" onerror="this.src='/static/default-avatar.png'">
                <div style="flex:1; min-width:150px;">
                    <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                        <span style="font-size:1.1rem; font-weight:bold; color:#ffffff;">${name}</span>
                        <span style="font-size:0.7rem; color:${textColor}; font-weight:600; background:rgba(0,0,0,0.3); padding:0.1rem 0.6rem; border-radius:12px;">${title}</span>
                    </div>
                    <div style="font-size:0.75rem; color:#a4adbc; margin-top:0.2rem; word-break:break-word;">${details}</div>
                </div>
                <div style="font-size:1.5rem; flex-shrink:0;">${medalEmoji}</div>
            </div>
        `;
    }

    // ✅ CONSTRUIR HTML DEL MODAL
    let html = `
        <div style="padding:0.5rem;">
            <h2 style="text-align:center; color:#ffd700; margin-bottom:1rem; font-size:1.2rem;">🏆 PODIO DE GANADORES</h2>
            <div style="max-height:65vh; overflow-y:auto; padding-right:0.5rem;">
    `;

    // Ganador (1er puesto)
    if (winner) {
        html += createPilotRow(winner, 1);
    }

    // Segundo puesto
    if (second) {
        html += createPilotRow(second, 2);
    }

    // Tercer puesto
    if (third) {
        html += createPilotRow(third, 3);
    }

    html += `
            </div>
            <div style="text-align:center; margin-top:1rem; padding-top:0.8rem; border-top:1px solid #2a2f3a;">
                <button onclick="closeWinnerModalComplete()" style="background:#e5484d; color:white; border:none; padding:0.6rem 2.5rem; border-radius:25px; cursor:pointer; font-weight:600; font-size:0.9rem; transition:background 0.2s;" onmouseover="this.style.background='#c73e42'" onmouseout="this.style.background='#e5484d'">CERRAR</button>
            </div>
        </div>
    `;

    // ✅ ACTUALIZAR EL MODAL
    const modalContent = document.querySelector('.winner-modal-content');
    if (modalContent) {
        modalContent.innerHTML = html;
    }

    const modal = document.getElementById('winnerModalComplete');
    modal.style.display = 'flex';

    // ✅ TIMER DE CIERRE AUTOMÁTICO
    const displayTime = winnerConfig.displayTime || 15;
    if (winnerModalTimer) clearTimeout(winnerModalTimer);
    winnerModalTimer = setTimeout(() => {
        closeWinnerModalComplete();
    }, displayTime * 1000);

    modal.onclick = (e) => {
        if (e.target === modal) {
            closeWinnerModalComplete();
        }
    };

    document.onkeydown = function (e) {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
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

    let speed = localStorage.getItem('chronit_countdown_speed');
    if (speed) {
        speed = parseFloat(speed);
        if (isNaN(speed) || speed < 0.3) speed = 1;
        if (speed > 2) speed = 2;
    } else {
        speed = 1;
    }

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

function setupCountdownControls() {
    const durationSlider = document.getElementById('countdownDurationSlider');
    const durationInput = document.getElementById('countdownDuration');
    const speedSlider = document.getElementById('countdownSpeedSlider');
    const speedHint = document.getElementById('speedHint');
    const saveBtn = document.getElementById('saveCountdownConfigBtn');
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

    if (speedSlider && speedHint) {
        speedSlider.oninput = () => {
            const val = sliderToCountdownSeconds(speedSlider.value);
            speedHint.innerText = `Cada número se mostrará durante ${val.toFixed(2)} segundos`;
        };
    }

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

function getCountdownSpeed() {
    let speed = localStorage.getItem('chronit_countdown_speed');
    if (speed) {
        speed = parseFloat(speed);
        if (!isNaN(speed) && speed >= 0.3 && speed <= 2) {
            return speed;
        }
    }
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

loadCountdownConfig();
setupCountdownControls();

loadLiveData();
loadTransponderHealth();
setInterval(() => {
    tvRotationIndex += 1;
    renderTvLapRotator();
    const clock = document.getElementById('tvClock');
    if (clock) clock.innerText = new Date().toLocaleTimeString();
}, 5000);

setInterval(() => {
    loadLiveData();
    updateTimeRemaining();  // <--- AGREGAR ESTA LÍNEA
}, 1000);


document.getElementById('showWinnerBtn').onclick = async () => {
    const podiumRes = await apiCall('/api/session/current/podium');
    const podium = podiumRes?.podium || [];
    if (podiumRes?.race_mode) currentRaceMode = normalizeRaceMode(podiumRes.race_mode);
    if (podium.length) {
        resetWinnerModalFlag();
        showWinnerModalComplete(podium[0], podium[1], podium[2]);
    }
};


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
                    <button class="btn btn-sm mini-btn" onclick="openBackupInSqlite('${b.filename}')" style="background:#2196f3;"> Ver</button>
                    <button class="btn btn-sm mini-btn" onclick="restoreBackup('${b.filename}')" style="background:#e5484d;">Restaurar</button>
                    <button class="btn btn-sm mini-btn" onclick="deleteBackupFile('${b.filename}')" style="background:#ff9800;"> Eliminar</button>
                </div>
            </div>
        `).join('');
}
async function deleteBackupFile(filename) {
    if (!isAuthenticated || (currentUser?.role !== 'admin' && currentUser?.role !== 'developer')) {
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
    if (!isAuthenticated || (currentUser?.role !== 'admin' && currentUser?.role !== 'developer')) {
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

let pendingConfirmCallback = null;

function showConfirmTextModal(title, message, expectedText, onConfirm) {
    document.getElementById('confirmTextModalTitle').innerText = title;
    document.getElementById('confirmTextModalMessage').innerText = message;
    document.getElementById('confirmTextModalInput').value = '';
    document.getElementById('confirmTextModal').style.display = 'flex';
    pendingConfirmCallback = { expectedText, onConfirm };
}


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

const backupBtn = document.getElementById('backupBtn');
const softResetBtn = document.getElementById('softResetBtn');
const safeHardResetBtn = document.getElementById('safeHardResetBtn');

if (backupBtn) backupBtn.onclick = createBackup;
if (softResetBtn) softResetBtn.onclick = softReset;
if (safeHardResetBtn) safeHardResetBtn.onclick = safeHardReset;
let currentUser = null;
let isAuthenticated = false;

async function checkAuth() {
    try {
        // Si ya estamos autenticados, no volver a verificar
        if (isAuthenticated && currentUser) {
            console.log("[DEBUG] Ya autenticado, omitiendo checkAuth");
            return;
        }

        const res = await fetch('/api/auth/check', {
            credentials: 'include'
        });
        const data = await res.json();

        if (data.authenticated) {
            isAuthenticated = true;
            currentUser = data.user;
        } else {
            // Solo si no hay sesión en el backend, limpiar
            const token = localStorage.getItem('chronit_session_token');
            if (!token) {
                isAuthenticated = false;
                currentUser = null;
            }
        }
        updateAuthUI();
    } catch (e) {
        console.error('Error checking auth:', e);
        updateAuthUI();
    }
}

function updateAuthUI() {
    console.log("[DEBUG] updateAuthUI() - isAuthenticated:", isAuthenticated);
    console.log("[DEBUG] currentUser:", currentUser);

    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userStatus = document.getElementById('userStatus');
    const adminElements = document.querySelectorAll('.admin-only');
    const devElements = document.querySelectorAll('.dev-only');

    // ============================================================
    // ELEMENTOS DEL MENÚ RESPONSIVE
    // ============================================================
    const loginBtnMobile = document.getElementById('loginBtnMobile');
    const logoutBtnMobile = document.getElementById('logoutBtnMobile');
    const userStatusMobile = document.getElementById('userStatusMobile');

    // ✅ DIAGNÓSTICO: Verificar si existen
    console.log("[DEBUG] loginBtnMobile:", loginBtnMobile);
    console.log("[DEBUG] logoutBtnMobile:", logoutBtnMobile);
    console.log("[DEBUG] userStatusMobile:", userStatusMobile);

    if (isAuthenticated && currentUser) {
        // ============================================================
        // USUARIO AUTENTICADO
        // ============================================================
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        userStatus.textContent = `👤 ${currentUser.username} (${currentUser.role})`;
        userStatus.style.display = 'inline-block';

        currentUserRole = currentUser.role;
        isDeveloperMode = (currentUser.role === 'developer');

        // ✅ Mostrar elementos de administrador
        adminElements.forEach(el => {
            el.classList.remove('admin-only-hidden');
        });

        // ✅ Mostrar/ocultar elementos de desarrollador
        devElements.forEach(el => {
            if (isDeveloperMode) {
                el.style.display = 'block';
                el.classList.add('visible');
            } else {
                el.style.display = 'none';
                el.classList.remove('visible');
            }
        });

        // ============================================================
        // ACTUALIZAR MENÚ RESPONSIVE (AUTH) - USUARIO AUTENTICADO
        // ============================================================
        if (loginBtnMobile) {
            loginBtnMobile.style.display = 'none';
            console.log("[DEBUG] loginBtnMobile ocultado (autenticado)");
        }
        
        if (logoutBtnMobile) {
            logoutBtnMobile.style.display = 'block';
            //logoutBtnMobile.textContent = `👤 ${currentUser.username} (${currentUser.role})`;
            logoutBtnMobile.onclick = submitLogout;
            console.log("[DEBUG] logoutBtnMobile mostrado:", logoutBtnMobile.textContent);
        } else {
            console.warn("[DEBUG] ⚠️ logoutBtnMobile NO EXISTE en el DOM");
        }
        
        if (userStatusMobile) {
            userStatusMobile.style.display = 'block';
            userStatusMobile.textContent = `👤 ${currentUser.username} (${currentUser.role})`;
            console.log("[DEBUG] userStatusMobile mostrado:", userStatusMobile.textContent);
        } else {
            console.warn("[DEBUG] ⚠️ userStatusMobile NO EXISTE en el DOM");
        }

        // ============================================================
        // CONFIGURACIONES DE DESARROLLADOR (igual que antes)
        // ============================================================
        const columnsConfigCard = document.getElementById('columnsConfigCard');
        if (columnsConfigCard) {
            if (isDeveloperMode) {
                columnsConfigCard.style.display = 'block';
                setTimeout(() => {
                    renderColumnsConfigTable();
                }, 100);
            } else {
                columnsConfigCard.style.display = 'none';
            }
        }

        const simulationModeCard = document.getElementById('simulationModeCard');
        if (simulationModeCard) {
            if (isDeveloperMode) {
                simulationModeCard.style.display = 'block';
                loadSimulationMode();
                setupSimulationControls();
                setupSimulationSpeedControl();
            } else {
                simulationModeCard.style.display = 'none';
            }
        }

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

        const decoderModeCard = document.getElementById('decoderModeCard');
        if (decoderModeCard) {
            if (isDeveloperMode) {
                decoderModeCard.style.display = 'block';
                loadDecoderMode();
                setupDecoderModeControls();
            } else {
                decoderModeCard.style.display = 'none';
            }
        }

        updateDevModeBadge();

    } else {
        // ============================================================
        // USUARIO NO AUTENTICADO
        // ============================================================
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        userStatus.style.display = 'none';
        isDeveloperMode = false;
        currentUserRole = null;

        // ✅ Ocultar elementos de administrador
        adminElements.forEach(el => {
            el.classList.add('admin-only-hidden');
        });

        // ✅ Ocultar elementos de desarrollador
        devElements.forEach(el => {
            el.style.display = 'none';
            el.classList.remove('visible');
        });

        // ============================================================
        // ACTUALIZAR MENÚ RESPONSIVE (AUTH) - USUARIO NO AUTENTICADO
        // ============================================================
        if (loginBtnMobile) {
            loginBtnMobile.style.display = 'block';
            loginBtnMobile.textContent = 'Iniciar Sesión';
            loginBtnMobile.onclick = openLoginModal;
            console.log("[DEBUG] loginBtnMobile mostrado (no autenticado)");
        } else {
            console.warn("[DEBUG] ⚠️ loginBtnMobile NO EXISTE en el DOM");
        }
        
        if (logoutBtnMobile) {
            logoutBtnMobile.style.display = 'none';
            console.log("[DEBUG] logoutBtnMobile ocultado (no autenticado)");
        }
        
        if (userStatusMobile) {
            userStatusMobile.style.display = 'none';
            userStatusMobile.textContent = '';
            console.log("[DEBUG] userStatusMobile ocultado (no autenticado)");
        }

        // ============================================================
        // OCULTAR TODOS LOS PANELES DE DESARROLLADOR
        // ============================================================
        const columnsConfigCard = document.getElementById('columnsConfigCard');
        if (columnsConfigCard) columnsConfigCard.style.display = 'none';

        const simulationModeCard = document.getElementById('simulationModeCard');
        if (simulationModeCard) simulationModeCard.style.display = 'none';

        const devConsoleCard = document.getElementById('devConsoleCard');
        if (devConsoleCard) {
            devConsoleCard.style.display = 'none';
            stopConsoleAutoRefresh();
        }

        const decoderModeCard = document.getElementById('decoderModeCard');
        if (decoderModeCard) decoderModeCard.style.display = 'none';

        hideDevModeBadge();

        // ============================================================
        // REDIRIGIR A PANEL PÚBLICO SI ESTÁ EN PANEL ADMIN
        // ============================================================
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


document.getElementById('loginBtn').onclick = openLoginModal;
document.getElementById('cancelLoginBtn').onclick = closeLoginModal;
document.getElementById('submitLoginBtn').onclick = submitLogin;
document.getElementById('logoutBtn').onclick = submitLogout;
document.getElementById('loginPassword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitLogin();
});

document.getElementById('loginModal').onclick = (e) => {
    if (e.target === document.getElementById('loginModal')) {
        closeLoginModal();
    }
};

function saveLoginBeforeReload() {
    if (isAuthenticated && currentUser && sessionToken) {
        localStorage.setItem('chronit_session_token', sessionToken);
        localStorage.setItem('chronit_user', JSON.stringify({
            username: currentUser.username,
            role: currentUser.role
        }));
    }
}

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
                localStorage.removeItem('chronit_session_token');
                localStorage.removeItem('chronit_user');
            }
        } catch (e) {
            console.error("Restauración falló:", e);
            localStorage.removeItem('chronit_session_token');
            localStorage.removeItem('chronit_user');
        }
    }
}



async function openBackupInSqlite(filename) {
    showLoader(`Preparando respaldo ${filename} para visualización...`);

    try {
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
                <button class="btn btn-sm mini-btn" onclick="restorePilotosBackup('${b.filename}')" style="background:#e5484d;">Restaurar</button>
                <button class="btn btn-sm mini-btn" onclick="deletePilotosBackup('${b.filename}')" style="background:#ff9800;">Eliminar</button>
            </div>
        </div>
    `).join('');
}

async function deletePilotosBackup(filename) {
    if (!isAuthenticated || (currentUser?.role !== 'admin' && currentUser?.role !== 'developer')) {
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

// Botón de emergencia "Resetear Tablero" (abajo del todo)
document.getElementById('resetVistasBtn').onclick = () => {
    // Modal de confirmación
    showModal('⚠️ RESET DE EMERGENCIA',
        '¿Estás seguro de resetear el tablero?\n\n' +
        '⚠️ Se borrarán TODAS las vueltas de la carrera actual.\n' +
        '✅ Se CONSERVARÁN pilotos y transponders.\n' +
        '✅ Se CREARÁ una nueva sesión limpia.\n\n' +
        'Esta acción NO se puede deshacer.',
        async () => {
            showLoader('Reseteando tablero...');

            try {
                // Usar el mismo endpoint que el reset suave
                const res = await apiCall('/api/race/reset', { method: 'POST' });

                hideLoader();

                if (res?.success) {
                    showToast('✅', 'Tablero reseteado correctamente', 'success');
                    // Recargar todos los datos
                    await loadLiveData();
                    await loadDrivers();
                    // Cambiar al panel de control de carrera
                    document.querySelector('[data-panel="live"]').click();
                } else {
                    showToast('❌', res?.error || 'No se pudo resetear el tablero', 'error');
                }
            } catch (error) {
                hideLoader();
                console.error('Error en resetVistasBtn:', error);
                showToast('❌', 'Error al conectar con el servidor', 'error');
            }
        }
    );
};

async function showRaceStartSplash(raceName, lapsLimit) {
    console.log("🎬 showRaceStartSplash llamada", { raceName, lapsLimit });

    const splash = document.getElementById('raceStartSplash');
    if (!splash) {
        console.error("❌ No se encontró el elemento #raceStartSplash");
        return false;
    }

    const nameEl = document.getElementById('splashRaceName');
    const lapsEl = document.getElementById('splashLapsLimit');
    if (nameEl) nameEl.innerText = raceName;
    if (lapsEl) lapsEl.innerText = `Vueltas: ${lapsLimit}`;
    splash.style.display = 'flex';
    console.log("✅ Splash visible");

    await new Promise(resolve => setTimeout(resolve, 2000));

    splash.style.display = 'none';
    console.log("✅ Splash ocultado");

    return true;
}


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

if (document.getElementById('minLapTimeSlider')) {
    document.getElementById('minLapTimeSlider').oninput = function () {
        document.getElementById('minLapTimeValue').value = this.value;
    };
    document.getElementById('minLapTimeValue').onchange = function () {
        document.getElementById('minLapTimeSlider').value = this.value;
    };
}

if (document.getElementById('timeSourceSelect')) {
    document.getElementById('timeSourceSelect').onchange = function () {
        toggleMinLapTimeVisibility();
    };
}

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



function detectIpFromUrl() {
    try {
        const url = new URL(window.location.href);
        const hostname = url.hostname;

        // Si no es localhost y no es IP de Docker
        if (hostname !== 'localhost' &&
            hostname !== '127.0.0.1' &&
            !hostname.startsWith('172.') &&
            !hostname.startsWith('10.') &&
            !hostname.startsWith('169.254.')) {
            return hostname;
        }
        return null;
    } catch (e) {
        return null;
    }
}



async function cargarIpConexion() {
    console.log("📡 Cargando IP de conexión...");

    // ✅ 1. Si hay IP manual guardada, usarla
    const savedIp = localStorage.getItem('chronit_manual_ip');
    if (savedIp) {
        manualIp = savedIp;
        currentIp = savedIp;
        mostrarIpYQR(`http://${currentIp}:5000`);
        console.log("📌 Usando IP manual:", currentIp);
        return;
    }

    // ✅ 2. Detectar IP desde la URL (la más confiable)
    try {
        const url = new URL(window.location.href);
        const hostname = url.hostname;

        // ✅ Si es una IP o localhost, usarla
        if (hostname) {
            currentIp = hostname;
            mostrarIpYQR(`http://${currentIp}:5000`);
            console.log("📌 IP detectada desde URL:", currentIp);
            return;
        }
    } catch (e) {
        console.log('No se pudo detectar IP desde URL');
    }

    // ✅ 3. Intentar con la API (fallback)
    try {
        const res = await apiCall('/api/system/ip');
        console.log("📡 Respuesta de /api/system/ip:", res);

        if (res?.success && res.ips && res.ips.length > 0) {
            // ✅ Usar la primera IP (puede ser localhost, 172.x.x.x, 192.168.x.x, etc.)
            const ip = res.ips[0];
            if (ip) {
                currentIp = ip;
                mostrarIpYQR(`http://${currentIp}:5000`);
                console.log("📌 IP detectada desde API:", currentIp);
                return;
            }
        }

        // ✅ 4. Si todo falla, mostrar error con opción manual
        mostrarErrorIp();

    } catch (e) {
        console.error('Error al obtener IP:', e);
        mostrarErrorIp();
    }
}

function mostrarIpYQR(url) {
    const container = document.getElementById('ipListContainer');
    if (container) {
        const isManual = localStorage.getItem('chronit_manual_ip') !== null;
        const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');

        container.innerHTML = `
            <div style="background: #0d1218; border-radius: 8px; padding: 12px; margin-bottom: 8px; border: 1px solid ${isManual ? '#34d399' : '#2a2f3a'};">
                <div style="font-family: monospace; font-size: 1.1rem; color: ${isLocalhost ? '#ff9800' : '#00c853'}; word-break: break-all; display:flex; align-items:center; gap:8px;">
                    <span>🌐</span>
                    ${url}
                </div>
                <div style="font-size: 0.7rem; color: #666; margin-top: 4px; display:flex; justify-content:space-between; flex-wrap:wrap;">
                    <span>📱 ${isLocalhost ? 'Si estás en localhost, usa el botón "Configurar IP manual"' : 'Escanea el código QR o ingresa esta IP en tu celular'}</span>
                    ${isManual ? '<span style="color:#ff9800;">📌 Usando IP manual</span>' : ''}
                </div>
            </div>
        `;
    }
    generarQRLocal(url);
}

function mostrarErrorIp() {
    const container = document.getElementById('ipListContainer');
    if (container) {
        container.innerHTML = `
            <div style="background: #0d1218; border-radius: 8px; padding: 12px; border-left: 3px solid #ef7a86;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <span style="font-size:1.2rem;">⚠️</span>
                    <span style="color:#ef7a86; font-weight:600;">No se pudo detectar IP</span>
                </div>
                <div style="font-size:0.75rem; color:#a4adbc; line-height: 1.6;">
                    <strong style="color:#fff;">📌 Solución:</strong>
                    <br>
                    1. Abre una terminal y escribe: 
                    <code style="background:#1a1e26; padding:0.1rem 0.4rem; border-radius:4px; color:#ffd700;">hostname -I</code>
                    <br>
                    2. Copia la IP (ej: <strong style="color:#ffd700;">192.168.1.12</strong>)
                    <br>
                    3. Haz clic en <strong style="color:#3b82f6;">✏️ Configurar IP manual</strong>
                </div>
            </div>
        `;
    }
    document.getElementById('qrCodePlaceholder').innerHTML = `
        <div style="color: #888; font-size:0.8rem; padding:1rem;">
            <span style="font-size:2rem;">📱</span>
            <br>
            Configura una IP manual para ver el código QR
        </div>
    `;
}

function generarQRLocal(url) {
    const qrContainer = document.getElementById('qrCodePlaceholder');
    const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(url)}&size=160`;

    qrContainer.innerHTML = `
        <img src="${qrUrl}" width="160" height="160" alt="QR Code" style="margin: 0 auto; border-radius: 12px; background: white; padding: 8px;">
        <div style="font-family: monospace; font-size: 0.7rem; margin-top: 8px; word-break: break-all; color: #888;">
            ${url}
        </div>
        <p style="font-size:0.6rem; color:#666; margin-top:4px;">📱 Escanea con tu celular</p>
    `;
}

function generarQRPersonalizado(url) {
    const qrContainer = document.getElementById('qrCodePlaceholder');
    const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(url)}&size=200&margin=2`;

    qrContainer.innerHTML = `
        <div style="text-align: center;">
            <img src="${qrUrl}" width="160" height="160" alt="QR Code" 
                 style="margin: 0 auto; border-radius: 12px; background: white; padding: 8px;">
            <div style="font-family: monospace; font-size: 0.75rem; margin-top: 10px; color: #333; word-break: break-all;">
                ${url}
            </div>
            <p style="font-size: 0.7rem; color: #666; margin-top: 8px;">
                📱 Escanea con tu celular para ver la carrera en vivo
            </p>
        </div>
    `;
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

function loadManualIp() {
    const savedIp = localStorage.getItem('chronit_manual_ip');
    if (savedIp) {
        manualIp = savedIp;
        console.log('📌 IP manual cargada:', manualIp);
    }
}

function saveManualIp(ip) {
    if (ip && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
        localStorage.setItem('chronit_manual_ip', ip);
        manualIp = ip;
        showToast('✅', `IP manual guardada: ${ip}`, 'success');
        cargarIpConexion(); // Recargar IP
        return true;
    } else {
        showToast('❌', 'IP inválida. Ejemplo: 192.168.1.12', 'error');
        return false;
    }
}

function clearManualIp() {
    localStorage.removeItem('chronit_manual_ip');
    manualIp = null;
    showToast('🔄', 'Volviendo a detección automática', 'info');
    cargarIpConexion(); // Recargar IP
}

function setupIpModal() {
    const modal = document.getElementById('ipManualModal');
    const openBtn = document.getElementById('openIpModalBtn');
    const cancelBtn = document.getElementById('cancelIpModalBtn');
    const saveBtn = document.getElementById('saveIpModalBtn');
    const clearBtn = document.getElementById('clearManualIpBtn');
    const input = document.getElementById('manualIpInput');

    if (!modal) return;

    const closeModal = () => {
        modal.style.display = 'none';
        input.value = '';
    };

    if (openBtn) {
        openBtn.onclick = () => {
            const savedIp = localStorage.getItem('chronit_manual_ip');
            if (savedIp) input.value = savedIp;
            modal.style.display = 'flex';
            setTimeout(() => input.focus(), 100);
        };
    }

    if (cancelBtn) cancelBtn.onclick = closeModal;

    if (saveBtn) {
        saveBtn.onclick = () => {
            const ip = input.value.trim();
            const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
            if (!ipRegex.test(ip)) {
                showToast('❌', 'IP inválida. Ejemplo: 192.168.1.12', 'error');
                return;
            }
            localStorage.setItem('chronit_manual_ip', ip);
            manualIp = ip;
            currentIp = ip;
            showToast('✅', `IP manual guardada: ${ip}`, 'success');
            closeModal();
            cargarIpConexion();
        };
    }

    if (clearBtn) {
        clearBtn.onclick = () => {
            localStorage.removeItem('chronit_manual_ip');
            manualIp = null;
            currentIp = null;
            showToast('🔄', 'Volviendo a detección automática', 'info');
            closeModal();
            cargarIpConexion();
        };
    }

    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (saveBtn) saveBtn.click();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
    });

    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

loadManualIp();
loadTranspondersIntoSelect();

// Cargar transponders en el select del formulario de registro
async function loadTranspondersIntoSelect() {
    const sel = document.getElementById('driverTransponder');
    if (!sel) return;
    const allTransponders = await apiCall('/api/transponders/all');
    const drivers = allDriversData.length ? allDriversData : (await apiCall('/api/drivers'));

    // Mapa: transponder_id → driver info
    const assignedMap = {};
    drivers.forEach(d => {
        if (d.transponder_id) assignedMap[d.transponder_id] = d;
    });

    sel.innerHTML = '<option value="">-- Sin Transponder --</option>';
    if (allTransponders && allTransponders.length) {
        for (const t of allTransponders) {
            const assigned = assignedMap[t.id];
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.id}${t.kart_id ? ' - ' + t.kart_id : ''}${assigned ? ' 🔒 ' + assigned.name : ''}${t.description ? ' - ' + t.description : ''}`;
            if (assigned) {
                opt.style.color = '#e5484d';
                opt.textContent += ' (EN USO)';
            }
            sel.appendChild(opt);
        }
    }
}

// Event delegation: click en cualquier parte de la fila abre modal de edición
document.getElementById('driversList')?.addEventListener('click', function (e) {
    const trigger = e.target.closest('.driver-edit-trigger');
    if (!trigger) return;
    const row = trigger.closest('tr');
    if (!row) return;
    const driverId = parseInt(row.dataset.driverId);
    if (!driverId) return;
    const driver = allDriversData.find(d => d.id === driverId);
    if (driver) {
        openDriverEditModal(driver);
    }
});

// Search drivers - INDEPENDIENTE: solo filtra lista de registro
document.getElementById('driverSearchInput')?.addEventListener('input', function () {
    renderDriversTable(this.value);
});

// Enrollment search - INDEPENDIENTE: solo filtra checkboxes de inscripción
let enrollmentSearchTimer = null;
document.getElementById('enrollmentSearch')?.addEventListener('input', function () {
    clearTimeout(enrollmentSearchTimer);
    const term = this.value;
    enrollmentSearchTimer = setTimeout(() => {
        loadEnrollmentCheckboxes(term);
    }, 150);
});

// Clear transponders button
document.getElementById('clearTranspondersBtn')?.addEventListener('click', function () {
    showModal('Borrar Transponders', '¿Quitar el código de transponder de TODOS los pilotos?', async () => {
        showLoader('Borrando transponders...');
        const res = await apiCall('/api/drivers/clear-transponders', { method: 'POST' });
        hideLoader();
        if (res?.success) {
            showToast('✅', 'Transponders borrados', 'success');
            loadDrivers();
        } else {
            showToast('❌', res?.error || 'Error', 'error');
        }
    });
});

// Unenroll all button
document.getElementById('unenrollAllBtn')?.addEventListener('click', function () {
    showModal('Desinscribir Todos', '¿Desinscribir a todos los pilotos de la carrera?', async () => {
        showLoader('Desinscribiendo pilotos...');
        const res = await apiCall('/api/race/unenroll-all', { method: 'POST' });
        hideLoader();
        if (res?.success) {
            showToast('✅', 'Todos los pilotos desinscritos', 'success');
            persistentCheckedIds.clear();
            loadDrivers();
            loadLiveData();
        } else {
            showToast('❌', res?.error || 'Error', 'error');
        }
    });
});
setupIpModal();

// ============================================================
// FUNCIÓN SHOWTOAST CORREGIDA (Problema #12)
// ============================================================
function showToast(title, message, type = 'info') {
    // Normalizar el tipo para que siempre sea válido
    const validTypes = ['success', 'error', 'warning', 'info'];
    const normalizedType = validTypes.includes(type) ? type : 'info';

    // Colores definidos para cada tipo
    const colors = {
        success: { bg: '#28a745', text: '#ffffff' },
        error: { bg: '#dc3545', text: '#ffffff' },
        warning: { bg: '#ffc107', text: '#212529' },
        info: { bg: '#17a2b8', text: '#ffffff' }
    };

    const colorConfig = colors[normalizedType];

    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.backgroundColor = colorConfig.bg;
    toast.style.color = colorConfig.text;
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '10001';
    toast.style.fontSize = '0.9rem';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    toast.style.transition = 'opacity 0.3s ease';
    toast.style.opacity = '0';

    // Estructura HTML mejorada con título y mensaje
    toast.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 4px;">${title}</div>
        <div style="font-size: 0.85rem; opacity: 0.9;">${message}</div>
    `;

    document.body.appendChild(toast);

    // Animación de entrada
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
    });

    // Eliminar toast después de 3 segundos
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, 3000);
}

// ============================================================
// FUNCIONES DE MAPEO (CORREGIDO - Problema #13)
// ============================================================
function mapSpeedToSlider(speed) {
    // speed 0.2 (rápido) → slider 100
    // speed 5 (lento) → slider 0
    const inverted = 100 - ((speed - 0.2) / (5 - 0.2)) * 100;
    return Math.min(100, Math.max(0, inverted));
}

function mapSliderToSpeed(sliderValue) {
    // slider 100 → speed 0.2 (rápido)
    // slider 0 → speed 5 (lento)
    const speed = 0.2 + ((100 - sliderValue) / 100) * (5 - 0.2);
    return parseFloat(speed.toFixed(2));
}

function loadSimulationSpeed() {
    const saved = localStorage.getItem('chronit_simulation_speed');
    const speed = saved ? parseFloat(saved) : 0.5;
    const slider = document.getElementById('simulationSpeedSlider');
    const display = document.getElementById('simulationSpeedValue');

    if (slider) {
        const invertedValue = mapSpeedToSlider(speed);
        slider.value = invertedValue;
    }
    if (display) display.textContent = speed.toFixed(1) + 's';
    return speed;
}

function saveSimulationSpeed(speed) {
    localStorage.setItem('chronit_simulation_speed', speed);
    apiCall('/api/simulation/speed', {
        method: 'POST',
        body: JSON.stringify({ speed: parseFloat(speed) })
    });
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

    const DEFAULT_PHOTO = '/static/default-avatar.png';

    if (!leaderboard || !leaderboard.length) {
        container.innerHTML = '<div style="text-align:center; padding:2rem;">Sin pilotos inscritos</div>';
        return;
    }

    const raceMode = normalizeRaceMode(session.race_mode);

    container.innerHTML = leaderboard.map((driver, idx) => {
        const color = driverColors[idx % driverColors.length];

        let best = '--';
        if (driver.best_lap && driver.best_lap > 0) {
            best = formatRaceClock(driver.best_lap);
        }

        let calculatedTotalTime = '--';
        if (driver.first_detection && driver.last_detection) {
            const first = new Date(driver.first_detection).getTime();
            const last = new Date(driver.last_detection).getTime();
            if (!isNaN(first) && !isNaN(last) && last > first) {
                const diffSeconds = (last - first) / 1000;
                calculatedTotalTime = formatRaceClock(diffSeconds);
            }
        }

        const individualTime = driver.total_time != null ? formatRaceClock(driver.total_time) : calculatedTotalTime;

        let totalTime = '--';
        if (session.race_elapsed_seconds !== undefined && session.race_elapsed_seconds !== null) {
            let seconds = session.race_elapsed_seconds;
            if (session.status === 'active') {
                seconds += (Date.now() - raceTimerState.lastSyncMs) / 1000;
            }
            totalTime = formatRaceClock(seconds);
        }

        let tiempoPrincipal = '--';
        let tiempoSecundario = '--';

        if (raceMode === 'time_attack') {
            const driverTotal = (driver.race_total_time != null && driver.race_total_time > 0)
                ? formatRaceClock(driver.race_total_time)
                : '--';
            tiempoPrincipal = driverTotal;

            let tiempoTranscurrido = '--';
            if (driver.first_detection) {
                const now = Date.now();
                const firstDetMs = new Date(driver.first_detection).getTime();
                if (!isNaN(firstDetMs)) {
                    const elapsedSec = (now - firstDetMs) / 1000;
                    if (driver.is_finished && driver.race_total_time != null && driver.race_total_time > 0) {
                        tiempoTranscurrido = formatRaceClock(driver.race_total_time);
                    } else {
                        tiempoTranscurrido = elapsedSec > 0 ? formatRaceClock(elapsedSec) : '--';
                    }
                }
            }
            tiempoSecundario = tiempoTranscurrido;

        } else if (raceMode === 'classification') {
            const bestLap = driver.best_lap ? formatRaceClock(driver.best_lap) : '--';
            tiempoPrincipal = bestLap;
            tiempoSecundario = `${driver.total_laps || 0} v`;

        } else if (raceMode === 'endurance') {
            const bestLap = driver.best_lap ? formatRaceClock(driver.best_lap) : '--';
            tiempoPrincipal = `${driver.total_laps || 0} v`;
            tiempoSecundario = bestLap;

        } else {
            tiempoPrincipal = individualTime;
            tiempoSecundario = totalTime;
        }

        const speed = speedsMap[driver.driver_id];
        const speedFormatted = (speed && speed > 0 && speed < 400) ? `${Math.round(speed)}` : '--';

        const kartLabel = driver.kart_id ? driver.kart_id : driver.transponder_id || '--';

        // ✅ FOTO DEL PILOTO
        const photoUrl = driver.photo && driver.photo !== 'default-avatar.png'
            ? `/static/uploads/drivers/${driver.photo}`
            : DEFAULT_PHOTO;

        const progressLineClass = idx === 0 ? 'line-gold' : 'line-blue';

        let cupIcon = '';
        if (raceMode === 'time_attack') {
            if (session.status === 'completed') {
                if (idx === 0) {
                    cupIcon = `<img src="/static/golden.svg" alt="Oro" style="height: 19px; width: auto; vertical-align: middle; padding: 0px 5px 0px 5px;">`;
                } else if (idx === 1) {
                    cupIcon = `<img src="/static/silver.svg" alt="Plata" style="height: 19px; width: auto; vertical-align: middle; padding: 0px 5px 0px 5px;">`;
                } else if (idx === 2) {
                    cupIcon = `<img src="/static/bronze.svg" alt="Bronce" style="height: 19px; width: auto; vertical-align: middle; padding: 0px 5px 0px 5px;">`;
                }
            }
        } else {
            if (driver.is_finished && driver.total_laps >= (session.laps_limit || 0)) {
                if (idx === 0) {
                    cupIcon = `<img src="/static/golden.svg" alt="Oro" style="height: 19px; width: auto; vertical-align: middle; padding: 0px 5px 0px 5px;">`;
                } else if (idx === 1) {
                    cupIcon = `<img src="/static/silver.svg" alt="Plata" style="height: 19px; width: auto; vertical-align: middle; padding: 0px 5px 0px 5px;">`;
                } else if (idx === 2) {
                    cupIcon = `<img src="/static/bronze.svg" alt="Bronce" style="height: 19px; width: auto; vertical-align: middle; padding: 0px 5px 0px 5px;">`;
                }
            }
        }

        return `
            <div class="k-row ${idx === 0 ? 'row-first' : ''}">
                <div class="k-col-pos">${driver.position || (idx + 1)}</div>
                <div class="k-col-name">
                    <img src="${photoUrl}" class="driver-photo-leaderboard" onerror="this.src='${DEFAULT_PHOTO}'">
                    <span class="driver-name">${driver.full_name || driver.name}${cupIcon}</span>
                    <div class="progress-line ${progressLineClass}" style="background: linear-gradient(90deg, ${color}, transparent);"></div>
                </div>
                <div class="k-col-vueltas">${driver.total_laps || 0}/${session.laps_limit || 0}</div>
                <div class="k-col-dif"><span class="time-box box-black">${driver.gap || (idx === 0 ? 'Líder' : '--')}</span></div>
                <div class="k-col-mejor"><span class="time-box box-gold">${best}</span></div>
                <div class="k-col-tiempo"><span class="time-box box-black">${tiempoPrincipal}</span></div>
                <div class="k-col-tiempo-individual"><span class="time-box box-black">${tiempoSecundario}</span></div>
                <div class="k-col-velocidad">
                    <span class="time-box box-black">${speedFormatted} <span style="color: yellow; font-size: 0.6rem; margin-left: 2px;">km/h</span></span>
                </div>
                <div class="k-col-kart"><span class="kart-circle" style="background-color: ${color};">${kartLabel}</span></div>
            </div>
        `;
    }).join('');

    applyColumnsConfig();
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

    const liveTotalTime = document.getElementById('liveTotalTime');
    if (liveTotalTime) {
        let seconds = session.race_elapsed_seconds || 0;
        if (session.status === 'active') {
            seconds += (Date.now() - raceTimerState.lastSyncMs) / 1000;
        }
        liveTotalTime.innerText = formatRaceClock(seconds);
    }

    const timerEl = document.getElementById('liveTotalTime');
    if (timerEl) {
        timerEl.classList.remove('status-pending', 'status-active', 'status-paused', 'status-completed', 'status-timeout');

        const status = session.status || 'pending';
        const raceMode = normalizeRaceMode(session.race_mode);
        const isTimedMode = (raceMode === 'endurance' || raceMode === 'classification');

        if (isTimedMode && status === 'completed') {
            timerEl.classList.add('status-timeout');
        } else {
            timerEl.classList.add(`status-${status}`);
        }

        if (isTimedMode && status === 'active') {
            timerEl.classList.remove('status-active');
            timerEl.classList.add('status-active');
        }
    }
}

let pendingMinimalTransponderId = null;
let pendingMinimalCallback = null;

function showEditTransponderModal(transponderId, onConfirm) {
    pendingMinimalTransponderId = transponderId;
    pendingMinimalCallback = onConfirm;

    const modal = document.getElementById('editTransponderMinimalModal');
    const input = document.getElementById('editTransponderMinimalInput');
    const msg = document.getElementById('editTransponderMinimalMsg');

    msg.innerText = `Ingrese el nuevo ID para el respondedor ${transponderId}:`;
    input.value = transponderId;

    modal.style.display = 'flex';

    setTimeout(() => input.focus(), 100);

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

setupDriverModalEvents();

if (document.getElementById('trackLengthSlider')) {
    document.getElementById('trackLengthSlider').oninput = function () {
        document.getElementById('trackLengthValue').value = this.value;
    };
    document.getElementById('trackLengthValue').onchange = function () {
        document.getElementById('trackLengthSlider').value = this.value;
    };
}

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
        // ✅ Si viene 0 de la BD, usar 0.33 visualmente
        let trackLength = res.track_length_km || 0;
        if (trackLength === 0) {
            trackLength = 0.33;
        }
        const trackType = res.track_type || 'karting';

        const slider = document.getElementById('trackLengthSlider');
        const valueInput = document.getElementById('trackLengthValue');
        const typeSelect = document.getElementById('trackTypeSelect');

        if (slider) slider.value = trackLength;
        if (valueInput) valueInput.value = trackLength;
        if (typeSelect) typeSelect.value = trackType;

        updateTrackLengthHint(trackType);

        // ✅ Debug: mostrar valor cargado
        console.log("[CONFIG] Largo de pista cargado:", trackLength, "km");
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

        const speedControl = document.getElementById('simulationSpeedControl');
        if (speedControl) {
            speedControl.style.display = isSimulationMode ? 'block' : 'none';
        }
    }

    applySimulationMode();
}

function applySimulationMode() {
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

            const speedControl = document.getElementById('simulationSpeedControl');
            if (speedControl) {
                speedControl.style.display = isSimulationMode ? 'block' : 'none';
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

function setupSimulationSpeedControl() {
    const slider = document.getElementById('simulationSpeedSlider');
    const display = document.getElementById('simulationSpeedValue');
    if (!slider || !display) return;

    // Cargar velocidad guardada y ajustar slider invertido
    const savedSpeed = loadSimulationSpeed();

    // Configurar valores del slider (min=0, max=100 para invertir)
    slider.min = 0;
    slider.max = 100;
    slider.step = 1;

    // Actualizar display cuando cambia el slider
    const updateDisplay = () => {
        const sliderValue = parseInt(slider.value);
        const speed = mapSliderToSpeed(sliderValue);
        display.textContent = speed.toFixed(1) + 's';
    };

    // Evento input (mientras se mueve)
    slider.addEventListener('input', () => {
        updateDisplay();
    });

    // Evento change (al soltar)
    slider.addEventListener('change', () => {
        const sliderValue = parseInt(slider.value);
        const speed = mapSliderToSpeed(sliderValue);
        saveSimulationSpeed(speed);
        // También actualizar el valor invertido en localStorage
        localStorage.setItem('chronit_simulation_speed', speed);
        console.log("[SIMULACIÓN] Velocidad cambiada a:", speed, "s");
    });

    // Inicializar slider en posición invertida
    const initialSpeed = loadSimulationSpeed();
    const initialSliderValue = mapSpeedToSlider(initialSpeed);
    slider.value = initialSliderValue;
    updateDisplay();

    // ===== INICIALIZAR toggleTimeLimitInput AL CARGAR =====
    document.addEventListener('DOMContentLoaded', function () {
        // Esperar que el DOM esté listo
        setTimeout(() => {
            toggleTimeLimitInput();
        }, 100);
    });
    document.getElementById('newRaceMode')?.addEventListener('change', toggleTimeLimitInput);
}

let consoleInterval = null;
async function loadRealtimeLogs() {
    if (!isDeveloperMode) {
        console.log("🔴 Modo desarrollador no activo");
        return;
    }

    try {

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
    a.download = `chronit_logs_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
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


async function loadDecoderMode() {
    try {
        const res = await apiCall('/api/decoder/mode');
        if (res && res.mode) {
            const select = document.getElementById('decoderModeSelect');
            const statusSpan = document.getElementById('decoderModeStatus');
            const protocolInfo = document.getElementById('decoderProtocolInfo');

            if (select) select.value = res.mode;

            // Información de cada modo
            const modeInfo = {
                'chronit': {
                    status: '🏁 CHRONIT',
                    protocol: 'Formato: $ID,HH:MM:SS.mmm,Vueltas,Señal | Ej: $24417,14:32:10.123,7,180'
                },
                'a120': {
                    status: '⚡ A-120',
                    protocol: 'Formato binario AMB-120 | 0x02 + ID(4) + Timestamp(4) + Vueltas(1) + Señal(1) + 0x03 | Timestamp en diezmilésimas'
                },
                'a20': {
                    status: '🔋 A-20',
                    protocol: 'Formato binario AMB-20 | ID(3) + Timestamp(4) + Vueltas(1) + Señal(1) | Timestamp en milisegundos'
                },
                'fr01': {
                    status: '🏎️ FR-01',
                    protocol: 'Formato Chronelec | $ID,MS_Desde_Medianoche,Vueltas,Señal | MS desde 00:00:00'
                }
            };

            if (statusSpan) {
                statusSpan.innerText = modeInfo[res.mode]?.status || res.mode;
                statusSpan.style.background = '#2196f3';
                statusSpan.style.color = 'white';
                statusSpan.style.padding = '2px 8px';
                statusSpan.style.borderRadius = '20px';
            }

            if (protocolInfo) {
                protocolInfo.value = modeInfo[res.mode]?.protocol || '';
            }

            updateDecoderModeHint(res.mode);
        }
    } catch (e) {
        console.error("Error cargando modo decoder:", e);
        // Mostrar valores por defecto en caso de error
        const protocolInfo = document.getElementById('decoderProtocolInfo');
        if (protocolInfo) protocolInfo.value = 'Error al cargar configuración del decoder';
    }
}

function updateDecoderModeHint(mode) {
    const hint = document.getElementById('decoderModeHint');
    const hints = {
        'chronit': 'CHRONIT: Formato estándar con tiempo en formato HH:MM:SS.mmm',
        'a120': 'A-120: Formato binario AMB-120. Tiempo como contador de diezmilésimas desde inicio',
        'a20': 'A-20: Formato binario optimizado AMB-20. ID de 3 bytes',
        'fr01': 'FR-01: Formato Chronelec. Tiempo en milisegundos desde medianoche (00:00:00)'
    };
    if (hint) hint.innerText = hints[mode] || '';
}



function setupDecoderModeControls() {
    const saveBtn = document.getElementById('saveDecoderModeBtn');
    const select = document.getElementById('decoderModeSelect');
    const warning = document.getElementById('decoderModeWarning');

    if (!saveBtn) return;

    saveBtn.onclick = async () => {
        const mode = select.value;

        showLoader(`Cambiando modo a ${mode.toUpperCase()}...`);

        const res = await apiCall('/api/decoder/mode', {
            method: 'POST',
            body: JSON.stringify({ mode: mode })
        });

        hideLoader();

        if (res?.success) {
            showToast('✅', `Modo cambiado a ${mode.toUpperCase()}`, 'success');
            if (warning) warning.style.display = 'block';

            // Actualizar información
            loadDecoderMode();

            // Sugerir reinicio después de 3 segundos
            setTimeout(() => {
                showToast('🔄', 'Reinicia la carrera para aplicar los cambios', 'info');
                if (warning) warning.style.display = 'none';
            }, 5000);
        } else {
            showToast('❌', res?.error || 'Error al cambiar modo', 'error');
        }
    };
}

async function loadRaceHistory(searchTerm = '') {
    const container = document.getElementById('historyListContainer');
    if (!container) return;

    container.innerHTML = '<div style="text-align: center; padding: 2rem;">Cargando historial...</div>';

    try {
        const history = await apiCall('/api/race/history');

        if (!history || history.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #888;">No hay carreras finalizadas</div>';
            allRaceHistory = [];
            return;
        }

        // Guardar todas las carreras para filtrar
        allRaceHistory = history;

        // Filtrar si hay término de búsqueda
        let filteredHistory = history;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredHistory = history.filter(race => {
                return race.circuit_name?.toLowerCase().includes(term) ||
                    (race.winner_name?.toLowerCase().includes(term)) ||
                    (race.winner_lastname?.toLowerCase().includes(term)) ||
                    race.id?.toString().includes(term);
            });
        }

        if (filteredHistory.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #ff9800;">No se encontraron carreras con ese criterio</div>';
            return;
        }

        container.innerHTML = filteredHistory.map(race => {
            const modeLabel = race.race_mode === 'time_attack' ? '🏁 CLASIFICACIÓN' : '🏎️ CARRERA';
            const winner = race.winner_name ? `${race.winner_name} ${race.winner_lastname || ''}` : '--';
            const winnerTime = race.winner_time ? formatRaceClock(race.winner_time) : '--';

            return `
                <div style="border-radius: 12px; padding: 1rem; margin-bottom: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
                        <div style="flex: 1;">
                            <div style="font-weight: bold; font-size: 1.1rem; color: #ffd700;">${escapeHtml(race.circuit_name)}</div>
                            <div style="font-size: 0.7rem; color: #888; margin-top: 0.2rem;">${modeLabel} | ${race.laps_limit} vueltas | ${race.total_drivers} pilotos | ID: ${race.id}</div>
                            <div style="font-size: 0.7rem; color: #666;">📅 ${race.end_time_formatted || '--'}</div>
                            <div style="font-size: 0.7rem; color: #00c853;">🏆 Ganador: ${winner} (${winnerTime})</div>
                        </div>
                        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                            <button class="btn btn-sm" onclick="viewRaceDetail(${race.id})" style="background: #2196f3;">📋 Ver detalles</button>
                            <button class="btn btn-sm" onclick="deleteRaceHistory(${race.id}, '${escapeHtml(race.circuit_name)}')" style="background: #e5484d;">🗑️ Eliminar</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        console.error('Error cargando historial:', e);
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #e5484d;">Error al cargar historial</div>';
    }
}


function setupHistorySearch() {
    const searchInput = document.getElementById('historySearchInput');
    const searchBtn = document.getElementById('historySearchBtn');
    const clearBtn = document.getElementById('historyClearSearchBtn');
    const pilotSearch = document.getElementById('historyPilotSearch');
    const pilotSearchBtn = document.getElementById('historyPilotSearchBtn');
    const pilotClearBtn = document.getElementById('historyPilotClearBtn');

    // Buscador de carreras (existente)
    if (searchInput && searchBtn && clearBtn) {
        searchBtn.onclick = () => {
            // Limpiar filtro de piloto al buscar por carrera
            if (pilotSearch) pilotSearch.value = '';
            currentPilotFilter = null;
            currentHistoryFilter = searchInput.value;
            loadRaceHistory(currentHistoryFilter);
        };

        clearBtn.onclick = () => {
            searchInput.value = '';
            currentHistoryFilter = '';
            if (pilotSearch) pilotSearch.value = '';
            currentPilotFilter = null;
            document.getElementById('historyPilotCount').innerText = '0 carreras';
            loadRaceHistory('');
        };

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (pilotSearch) pilotSearch.value = '';
                currentPilotFilter = null;
                currentHistoryFilter = searchInput.value;
                loadRaceHistory(currentHistoryFilter);
            }
        });
    }

    // ✅ NUEVO: Buscador de pilotos
    if (pilotSearch && pilotSearchBtn && pilotClearBtn) {
        pilotSearchBtn.onclick = () => {
            const term = pilotSearch.value.trim();
            if (term) {
                // Limpiar filtro de carrera
                if (searchInput) searchInput.value = '';
                currentHistoryFilter = '';
                currentPilotFilter = term;
                loadPilotHistory(term);
            } else {
                showToast('⚠️', 'Ingresa el nombre o ID del piloto', 'warning');
            }
        };

        pilotClearBtn.onclick = () => {
            pilotSearch.value = '';
            currentPilotFilter = null;
            document.getElementById('historyPilotCount').innerText = '0 carreras';
            if (searchInput) searchInput.value = '';
            currentHistoryFilter = '';
            loadRaceHistory('');
        };

        pilotSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const term = pilotSearch.value.trim();
                if (term) {
                    if (searchInput) searchInput.value = '';
                    currentHistoryFilter = '';
                    currentPilotFilter = term;
                    loadPilotHistory(term);
                }
            }
        });
    }
}

// Modificar loadRaceHistory para aceptar filtro
async function loadRaceHistory(searchTerm = '') {
    const container = document.getElementById('historyListContainer');
    if (!container) return;

    if (currentPilotFilter) {
        await loadPilotHistory(currentPilotFilter);
        return;
    }


    container.innerHTML = '<div style="text-align: center; padding: 2rem;">Cargando historial...</div>';

    try {
        const history = await apiCall('/api/race/history');

        if (!history || history.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #888;">No hay carreras finalizadas</div>';
            return;
        }

        // Filtrar si hay término de búsqueda
        let filteredHistory = history;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredHistory = history.filter(race => {
                return (race.circuit_name?.toLowerCase().includes(term) ||
                    (race.winner_name?.toLowerCase().includes(term)) ||
                    (race.winner_lastname?.toLowerCase().includes(term)));
            });
        }

        if (filteredHistory.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #ff9800;">No se encontraron carreras</div>';
            return;
        }

        container.innerHTML = filteredHistory.map(race => {
            const modeLabel = race.race_mode === 'time_attack' ? '🏁 CLASIFICACIÓN' : '🏎️ CARRERA';
            const winner = race.winner_name ? `${race.winner_name} ${race.winner_lastname || ''}` : '--';
            const winnerTime = race.winner_time ? formatRaceClock(race.winner_time) : '--';

            return `
        <div style="border-radius: 12px; padding: 1rem; margin-bottom: 1rem; border-left: 4px solid ${race.winner_name ? '#ffd700' : '#2a2f3a'};">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
                <div style="flex: 1;">
                    <div style="font-weight: bold; font-size: 1.1rem; color: #ffd700;">${escapeHtml(race.circuit_name)}</div>
                    <div style="font-size: 0.7rem; color: #888; margin-top: 0.2rem;">
                        ${modeLabel} | ${race.laps_limit} vueltas | ${race.total_drivers || 0} pilotos | ID: ${race.id}
                    </div>
                    <div style="font-size: 0.7rem; color: #666;">📅 ${race.end_time_formatted || '--'}</div>
                    <div style="font-size: 0.8rem; color: #00c853; margin-top: 0.3rem;">
                        🏆 Ganador: <strong style="color: #ffd700;">${winner}</strong> 
                        ${winnerTime !== '--' ? `(${winnerTime})` : ''}
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                    <button class="btn btn-sm" onclick="viewRaceDetail(${race.id})" style="background: #2196f3;">📋 Ver detalles</button>
                    <button class="btn btn-sm" onclick="deleteRaceHistory(${race.id}, '${escapeHtml(race.circuit_name)}')" style="background: #e5484d;">🗑️ Eliminar</button>
                </div>
            </div>
        </div>
    `;
        }).join('');

    } catch (e) {
        console.error('Error cargando historial:', e);
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #e5484d;">Error al cargar historial</div>';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

async function viewRaceDetail(sessionId) {
    showLoader('Cargando detalles de la carrera...');

    try {
        const detail = await apiCall(`/api/race/history/${sessionId}`);

        if (!detail || !detail.session) {
            hideLoader();
            showToast('❌', 'No se pudo cargar el detalle', 'error');
            return;
        }

        const session = detail.session;
        const leaderboard = detail.leaderboard || [];


        document.getElementById('detailRaceName').innerText = session.circuit_name || '--';
        document.getElementById('detailRaceMeta').innerText = `ID: ${session.id}`;
        document.getElementById('detailDate').innerText = session.end_time ? session.end_time.replace('T', ' ').slice(0, 19) : '--';
        document.getElementById('detailLaps').innerText = session.laps_limit || '--';
        document.getElementById('detailMode').innerText = session.race_mode === 'time_attack' ? 'CLASIFICACIÓN' : 'CARRERA';
        document.getElementById('detailWinner').innerText = session.winner_name ? `${session.winner_name} ${session.winner_lastname || ''}` : '--';
        document.getElementById('detailWinnerTime').innerText = session.winner_time ? formatRaceClock(session.winner_time) : '--';

        // Calcular duración
        if (session.start_time && session.end_time) {
            const start = new Date(session.start_time);
            const end = new Date(session.end_time);
            const durationSec = (end - start) / 1000;
            const hours = Math.floor(durationSec / 3600);
            const minutes = Math.floor((durationSec % 3600) / 60);
            const seconds = Math.floor(durationSec % 60);
            let durationStr = '';
            if (hours > 0) durationStr += `${hours}h `;
            if (minutes > 0 || hours > 0) durationStr += `${minutes}m `;
            durationStr += `${seconds}s`;
            document.getElementById('detailDuration').innerText = durationStr;
        } else {
            document.getElementById('detailDuration').innerText = '--';
        }


        const historyRaceMode = normalizeRaceMode(session.race_mode);

        const tbody = document.getElementById('detailLeaderboardBody');
        tbody.innerHTML = leaderboard.map((d, idx) => {
            const pos = d.position || idx + 1;
            let totalTime;

            // ✅ Calcular tiempo total desde first_detection y last_detection si es necesario
            let calculatedTotalTime = '--';
            if (d.first_detection && d.last_detection) {
                const first = new Date(d.first_detection).getTime();
                const last = new Date(d.last_detection).getTime();
                if (!isNaN(first) && !isNaN(last) && last > first) {
                    const diffSeconds = (last - first) / 1000;
                    calculatedTotalTime = formatRaceClock(diffSeconds);
                }
            }

            if (historyRaceMode === 'time_attack') {
                totalTime = d.real_total_time ? formatRaceClock(d.real_total_time) : calculatedTotalTime;
            } else {
                // POSITION RACE: priorizar total_time, luego finish_total_seconds, luego cálculo manual
                totalTime = d.total_time ? formatRaceClock(d.total_time) :
                    (d.finish_total_seconds ? formatRaceClock(d.finish_total_seconds) : calculatedTotalTime);
            }

            const bestLap = d.best_lap ? formatRaceClock(d.best_lap) : '--';
            const avgSpeed = d.avg_speed_kmh ? Math.round(d.avg_speed_kmh) : '--';
            const kartLabel = d.kart_id || d.transponder_id || '--';
            const isWinner = pos === 1;

            return `
                <tr style="border-bottom: 1px solid #2a2f3a; ${isWinner ? 'background: rgba(255,215,0,0.1);' : ''}">
                    <td style="padding: 0.7rem; font-weight: bold; text-align: center;">${pos}</td>
                    <td style="padding: 0.7rem;">${d.full_name || d.name} ${isWinner ? '🏆' : ''}</td>
                    <td style="padding: 0.7rem; text-align: center;">${kartLabel}</td>
                    <td style="padding: 0.7rem; text-align: center;">${d.total_laps || 0}/${session.laps_limit}</td>
                    <td style="padding: 0.7rem; font-family: monospace;">${totalTime}</td>
                    <td style="padding: 0.7rem; font-family: monospace;">${bestLap}</td>
                    <td style="padding: 0.7rem; text-align: center;">${avgSpeed} km/h</td>
                </tr>
            `;
        }).join('');


        const lapsAccordion = document.getElementById('detailLapsAccordion');
        if (detail.laps_by_driver) {
            lapsAccordion.innerHTML = Object.keys(detail.laps_by_driver).map(driverId => {
                const driver = leaderboard.find(d => d.driver_id == driverId);
                const driverName = driver ? (driver.full_name || driver.name) : `Piloto ${driverId}`;
                const laps = detail.laps_by_driver[driverId] || [];

                if (laps.length === 0) {
                    return `<div style="margin-bottom: 0.5rem; padding: 0.5rem; background: #0f1117; border-radius: 8px;">
                                <div style="font-weight: bold;">${driverName}</div>
                                <div style="font-size: 0.7rem; color: #888;">Sin vueltas registradas</div>
                            </div>`;
                }

                // ✅ Calcular la mejor vuelta del líder para este historial
                let leaderBestLap = null;
                if (leaderboard && leaderboard.length > 0) {
                    const leader = leaderboard[0];
                    leaderBestLap = leader.best_lap;
                }

                const lapsHtml = laps.map(lap => {
                    const lapTime = lap.lap_seconds ? formatRaceClock(lap.lap_seconds) : '--';
                    let gapToLeader = '--';

                    // ✅ Calcular diferencia con la mejor vuelta del líder
                    if (leaderBestLap && lap.lap_seconds) {
                        const diff = lap.lap_seconds - leaderBestLap;
                        if (Math.abs(diff) < 0.01) {
                            gapToLeader = 'Líder';
                        } else if (diff > 0) {
                            gapToLeader = `+${diff.toFixed(3)}s`;
                        } else {
                            gapToLeader = `-${Math.abs(diff).toFixed(3)}s`;
                        }
                    }

                    return `
                        <div style="display: flex; gap: 1rem; padding: 0.3rem 0; border-bottom: 1px solid #1a1e26; font-size: 0.75rem;">
                            <div style="width: 60px; font-weight: bold;">${lap.lap_number}</div>
                            <div style="width: 100px; font-family: monospace;">${lapTime}</div>
                            <div style="width: 100px; ${gapToLeader !== '--' && gapToLeader !== 'Líder' ? 'color: #ffd700;' : ''}">${gapToLeader}</div>
                        </div>
                    `;
                }).join('');

                return `
                    <div style="margin-bottom: 0.5rem; border-radius: 8px; overflow: hidden;">
                        <div onclick="toggleAccordion(this)" style="background: #0f1117; padding: 0.6rem 1rem; cursor: pointer; font-weight: bold; display: flex; justify-content: space-between;">
                            <span>${driverName}</span>
                            <span>▼</span>
                        </div>
                        <div class="accordion-content" style="padding: 0.5rem 1rem; background: #151a22; display: block;">
                            ${lapsHtml}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            lapsAccordion.innerHTML = '<div style="text-align: center; padding: 1rem; color: #888;">No hay detalles de vueltas</div>';
        }


        document.getElementById('raceDetailModal').style.display = 'flex';
        hideLoader();

    } catch (e) {
        hideLoader();
        console.error('Error cargando detalle:', e);
        showToast('❌', 'Error al cargar detalles', 'error');
    }
}

function toggleAccordion(element) {
    const content = element.nextElementSibling;
    if (content.style.display === 'none') {
        content.style.display = 'block';
        element.querySelector('span:last-child').innerText = '▼';
    } else {
        content.style.display = 'none';
        element.querySelector('span:last-child').innerText = '▶';
    }
}

document.getElementById('closeDetailModalBtn')?.addEventListener('click', () => {
    document.getElementById('raceDetailModal').style.display = 'none';
});

document.getElementById('raceDetailModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('raceDetailModal')) {
        document.getElementById('raceDetailModal').style.display = 'none';
    }
});

document.getElementById('refreshHistoryBtn')?.addEventListener('click', () => {
    loadRaceHistory();
    showToast('🔄', 'Historial actualizado', 'info');
});


// Modal para eliminar carrera con contraseña
let pendingDeleteSessionId = null;
let pendingDeleteSessionName = null;

async function deleteRaceHistory(sessionId, sessionName) {
    // Verificar rol del usuario
    const userStr = localStorage.getItem('chronit_user');
    let userRole = 'admin';

    if (userStr) {
        try {
            const user = JSON.parse(userStr);
            userRole = user.role;
        } catch (e) { }
    }

    // Solo developer puede eliminar
    if (userRole !== 'developer') {
        showToast('❌', 'Solo usuarios desarrolladores pueden eliminar carreras', 'error');
        return;
    }

    // Confirmar con modal simple (sin contraseña)
    showModal('⚠️ Eliminar Carrera',
        `¿Estás seguro de eliminar la carrera "${sessionName}"?\n\n⚠️ Esta acción no se puede deshacer.`,
        async () => {
            showLoader('Eliminando carrera...');

            const token = localStorage.getItem('chronit_session_token');
            const response = await fetch(`/api/race/history/${sessionId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Token': token
                }
            });

            const result = await response.json();
            hideLoader();

            if (result.success) {
                showToast('✅', `Carrera "${sessionName}" eliminada`, 'success');
                loadRaceHistory(currentHistoryFilter);
            } else {
                showToast('❌', result.error || 'No se pudo eliminar', 'error');
            }
        }
    );
}

async function confirmDeleteRace() {
    const password = document.getElementById('deletePasswordInput').value;

    if (!password) {
        showToast('⚠️', 'Ingresa la contraseña', 'warning');
        return;
    }

    // Verificar contraseña (solo admin o developer puede eliminar)
    const token = localStorage.getItem('chronit_session_token');

    try {
        // Verificar rol del usuario
        const verifyRes = await fetch('/api/auth/verify-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_token: token })
        });
        const userData = await verifyRes.json();

        if (!userData.success) {
            showToast('❌', 'No autorizado. Inicia sesión nuevamente.', 'error');
            closeDeleteModal();
            return;
        }

        const userRole = userData.user?.role;

        // Solo admin o developer pueden eliminar
        if (userRole !== 'admin' && userRole !== 'developer') {
            showToast('❌', 'No tienes permisos para eliminar carreras', 'error');
            closeDeleteModal();
            return;
        }

        // Verificar contraseña (usando la misma del login)
        // Simple: comparar con la contraseña del usuario logueado
        const loginRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: userData.user.username,
                password: password
            })
        });
        const loginData = await loginRes.json();

        if (!loginData.success) {
            showToast('❌', 'Contraseña incorrecta', 'error');
            return;
        }

        // Contraseña correcta, proceder a eliminar
        showLoader(`Eliminando carrera "${pendingDeleteSessionName}"...`);

        const deleteRes = await apiCall(`/api/race/history/${pendingDeleteSessionId}`, {
            method: 'DELETE'
        });

        hideLoader();

        if (deleteRes?.success) {
            showToast('✅', `Carrera "${pendingDeleteSessionName}" eliminada`, 'success');
            closeDeleteModal();
            loadRaceHistory(currentHistoryFilter); // Recargar lista con el filtro actual
        } else {
            showToast('❌', deleteRes?.error || 'No se pudo eliminar la carrera', 'error');
        }

    } catch (error) {
        hideLoader();
        console.error('Error al eliminar:', error);
        showToast('❌', 'Error al conectar con el servidor', 'error');
    }
}

function closeDeleteModal() {
    document.getElementById('deletePasswordModal').style.display = 'none';
    pendingDeleteSessionId = null;
    pendingDeleteSessionName = null;
}





async function loadPilotHistory(pilotSearchTerm) {
    const container = document.getElementById('historyListContainer');
    if (!container) return;

    // Si no hay término de búsqueda, cargar historial normal
    if (!pilotSearchTerm || pilotSearchTerm.trim() === '') {
        currentPilotFilter = null;
        await loadRaceHistory(currentHistoryFilter);
        return;
    }

    container.innerHTML = '<div style="text-align: center; padding: 2rem;">🔍 Buscando carreras del piloto...</div>';

    try {
        // 1. Buscar pilotos que coincidan
        const drivers = await apiCall('/api/drivers');
        const searchTerm = pilotSearchTerm.toLowerCase().trim();

        const matchedDrivers = drivers.filter(d =>
            (d.name || '').toLowerCase().includes(searchTerm) ||
            (d.lastname || '').toLowerCase().includes(searchTerm) ||
            String(d.id).includes(searchTerm) ||
            String(d.transponder_id || '').includes(searchTerm)
        );

        if (matchedDrivers.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #ff9800;">
                    ❌ No se encontró ningún piloto con el término "${pilotSearchTerm}"
                </div>
            `;
            document.getElementById('historyPilotCount').innerText = '0 carreras';
            return;
        }

        // 2. Obtener historial de carreras
        const history = await apiCall('/api/race/history');
        if (!history || history.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #888;">No hay carreras disponibles</div>';
            document.getElementById('historyPilotCount').innerText = '0 carreras';
            return;
        }

        // 3. Filtrar carreras donde el piloto participó
        const driverIds = matchedDrivers.map(d => d.id);

        // Obtener detalles de cada carrera para saber qué pilotos participaron
        let filteredRaces = [];
        for (const race of history) {
            const raceDetail = await apiCall(`/api/race/history/${race.id}`);
            if (raceDetail && raceDetail.leaderboard) {
                const participated = raceDetail.leaderboard.some(d => driverIds.includes(d.driver_id));
                if (participated) {
                    // Encontrar la info del piloto en esta carrera
                    const pilotData = raceDetail.leaderboard.find(d => driverIds.includes(d.driver_id));
                    filteredRaces.push({
                        ...race,
                        pilot_position: pilotData?.position || '--',
                        pilot_laps: pilotData?.total_laps || 0,
                        pilot_best_lap: pilotData?.best_lap || null,
                        pilot_total_time: pilotData?.total_time || null,
                        pilot_name: matchedDrivers.find(d => d.id === pilotData?.driver_id)?.name || '--'
                    });
                }
            }
        }

        // Guardar para mostrar en la UI
        allPilotsHistory = filteredRaces;

        // Actualizar contador
        document.getElementById('historyPilotCount').innerText = `${filteredRaces.length} carreras`;

        if (filteredRaces.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #ff9800;">
                    🏁 El piloto no ha participado en ninguna carrera
                </div>
            `;
            return;
        }

        // 4. Mostrar resultados
        container.innerHTML = filteredRaces.map(race => {
            const modeLabel = race.race_mode === 'time_attack' ? '🏁 CLASIFICACIÓN' : '🏎️ CARRERA';
            const position = race.pilot_position || '--';
            const laps = race.pilot_laps || 0;
            const bestLap = race.pilot_best_lap ? formatRaceClock(race.pilot_best_lap) : '--';
            const totalTime = race.pilot_total_time ? formatRaceClock(race.pilot_total_time) : '--';

            return `
                <div style="border-radius: 12px; padding: 1rem; margin-bottom: 1rem; border-left: 4px solid ${position === 1 ? '#ffd700' : '#2a2f3a'};">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
                        <div style="flex: 1;">
                            <div style="font-weight: bold; font-size: 1.1rem; color: #ffd700;">${race.circuit_name}</div>
                            <div style="font-size: 0.7rem; color: #888; margin-top: 0.2rem;">
                                ${modeLabel} | ${race.laps_limit} vueltas | ID: ${race.id}
                            </div>
                            <div style="font-size: 0.7rem; color: #666;">📅 ${race.end_time_formatted || '--'}</div>
                            <div style="font-size: 0.8rem; color: #00c853; margin-top: 0.3rem;">
                                🏁 Posición: <strong style="color: #ffd700;">${position}</strong> | 
                                🏎️ Vueltas: <strong>${laps}</strong> | 
                                ⏱️ Mejor vuelta: <strong>${bestLap}</strong> | 
                                📊 Tiempo total: <strong>${totalTime}</strong>
                            </div>
                            <div style="font-size: 0.7rem; color: #888; margin-top: 0.2rem;">
                                👤 Piloto: ${race.pilot_name}
                            </div>
                        </div>
                        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                            <button class="btn btn-sm" onclick="viewRaceDetail(${race.id})" style="background: #2196f3;">📋 Ver detalles</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        console.error('Error cargando historial del piloto:', e);
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #e5484d;">❌ Error al cargar historial del piloto</div>';
    }
}

// Función para limpiar filtro de piloto
function clearPilotFilter() {
    document.getElementById('historyPilotSearch').value = '';
    currentPilotFilter = null;
    document.getElementById('historyPilotCount').innerText = '0 carreras';
    loadRaceHistory(currentHistoryFilter);
}



// ============================================================
// MODAL DE ADVERTENCIA DE CAPACIDAD DE PILOTOS
// ============================================================

const MAX_RECOMMENDED_PILOTS = 15;
const MAX_SAFE_PILOTS = 20;

function showPilotCapacityWarning(currentCount, newCount, onConfirm) {
    const modal = document.getElementById('pilotCapacityModal');

    // ✅ VERIFICAR QUE EL MODAL EXISTA
    if (!modal) {
        console.warn('[CAPACITY] Modal no encontrado, inscribiendo directamente');
        if (onConfirm) onConfirm();
        return;
    }

    // ✅ OBTENER TODOS LOS ELEMENTOS CON VERIFICACIÓN
    const title = document.getElementById('pilotCapacityModalTitle');
    const message = document.getElementById('pilotCapacityModalMessage');
    const countSpan = document.getElementById('pilotCapacityModalCount');
    const totalSpan = document.getElementById('pilotCapacityModalTotal');
    const bar = document.getElementById('pilotCapacityModalBar');
    const confirmBtn = document.getElementById('pilotCapacityConfirmBtn');
    const cancelBtn = document.getElementById('pilotCapacityCancelBtn');

    // ✅ VERIFICAR QUE TODOS LOS ELEMENTOS EXISTAN
    if (!title || !message || !countSpan || !totalSpan || !bar || !confirmBtn || !cancelBtn) {
        console.warn('[CAPACITY] Faltan elementos del modal, inscribiendo directamente');
        if (onConfirm) onConfirm();
        return;
    }

    const total = currentCount + newCount;

    // ✅ ACTUALIZAR TEXTO
    countSpan.textContent = newCount;
    totalSpan.textContent = total;

    // ✅ ACTUALIZAR BARRA DE CAPACIDAD
    const percentage = Math.min(100, (total / MAX_SAFE_PILOTS) * 100);
    bar.style.width = percentage + '%';

    // ✅ CAMBIAR TÍTULO Y MENSAJE SEGÚN CANTIDAD
    if (total >= MAX_SAFE_PILOTS) {
        title.textContent = '⚠️ ¡DEMASIADOS PILOTOS!';
        title.style.color = '#ef7a86';
        message.innerHTML = `
            Estás inscribiendo <strong style="color:#ffd700;">${newCount}</strong> piloto(s), 
            lo que haría un total de <strong style="color:#ffd700;">${total}</strong> pilotos.
            <br><br>
            <span style="color:#ef7a86;">⚠️ El sistema puede saturarse con más de ${MAX_SAFE_PILOTS} pilotos.</span>
        `;
        confirmBtn.textContent = 'Continuar de todas formas ⚠️';
        confirmBtn.style.background = '#e5484d';
        confirmBtn.style.color = 'white';
    } else {
        title.textContent = '🟡 Cerca del límite recomendado';
        title.style.color = '#f4c06b';
        message.innerHTML = `
            Estás inscribiendo <strong style="color:#ffd700;">${newCount}</strong> piloto(s), 
            lo que haría un total de <strong style="color:#ffd700;">${total}</strong> pilotos.
            <br><br>
            <span style="color:#f4c06b;">🟡 Recomendado máximo: ${MAX_RECOMMENDED_PILOTS} pilotos.</span>
        `;
        confirmBtn.textContent = 'Continuar de todas formas';
        confirmBtn.style.background = '#f4c06b';
        confirmBtn.style.color = '#1a1a1a';
    }

    // ✅ MOSTRAR MODAL
    modal.style.display = 'flex';

    // ✅ EVENTOS DE LOS BOTONES
    const closeModal = () => {
        modal.style.display = 'none';
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
    };

    cancelBtn.onclick = closeModal;

    confirmBtn.onclick = () => {
        closeModal();
        if (onConfirm) onConfirm();
    };

    // ✅ CERRAR HACIENDO CLICK FUERA
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };

    // ✅ CERRAR CON ESC
    const escHandler = function (e) {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

// ============================================================
// FUNCIONES DE PAGINACIÓN PARA HISTORIAL
// ============================================================

function renderPagination(totalItems, currentPage, pageSize) {
    const container = document.getElementById('historyPaginationContainer');
    if (!container) return;

    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    // Actualizar info
    document.getElementById('historyPageInfo').innerText = totalItems > 0 ? `${startItem}-${endItem}` : '0';
    document.getElementById('historyTotalItems').innerText = totalItems;

    // Botones anterior/siguiente
    const prevBtn = document.getElementById('historyPagePrev');
    const nextBtn = document.getElementById('historyPageNext');
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

    // Números de página
    const pageNumbersContainer = document.getElementById('historyPageNumbers');
    if (!pageNumbersContainer) return;

    let pagesHtml = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    if (startPage > 1) {
        pagesHtml += `<button class="btn btn-sm page-number" data-page="1" style="background: #2a2f3a; padding: 0.3rem 0.6rem; font-size: 0.7rem;">1</button>`;
        if (startPage > 2) {
            pagesHtml += `<span style="color: #888; font-size: 0.7rem;">...</span>`;
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === currentPage;
        pagesHtml += `<button class="btn btn-sm page-number" data-page="${i}" style="background: ${isActive ? '#2196f3' : '#2a2f3a'}; padding: 0.3rem 0.6rem; font-size: 0.7rem; ${isActive ? 'font-weight: bold;' : ''}">${i}</button>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            pagesHtml += `<span style="color: #888; font-size: 0.7rem;">...</span>`;
        }
        pagesHtml += `<button class="btn btn-sm page-number" data-page="${totalPages}" style="background: #2a2f3a; padding: 0.3rem 0.6rem; font-size: 0.7rem;">${totalPages}</button>`;
    }

    pageNumbersContainer.innerHTML = pagesHtml;

    // Event listeners para los números de página
    document.querySelectorAll('.page-number').forEach(btn => {
        btn.onclick = () => {
            const page = parseInt(btn.dataset.page);
            if (page !== currentPage) {
                historyCurrentPage = page;
                renderCurrentHistoryPage();
            }
        };
    });
}

function renderCurrentHistoryPage() {
    const startIndex = (historyCurrentPage - 1) * historyPageSize;
    const endIndex = startIndex + historyPageSize;
    const pageData = historyFilteredData.slice(startIndex, endIndex);

    renderHistoryItems(pageData);
    renderPagination(historyFilteredData.length, historyCurrentPage, historyPageSize);
}

function renderHistoryItems(items) {
    const container = document.getElementById('historyListContainer');
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #888;">No hay carreras para mostrar</div>';
        return;
    }

    container.innerHTML = items.map(race => {
        const modeLabel = race.race_mode === 'time_attack' ? '🏁 CLASIFICACIÓN' : '🏎️ CARRERA';
        const winner = race.winner_name ? `${race.winner_name} ${race.winner_lastname || ''}` : '--';
        const winnerTime = race.winner_time ? formatRaceClock(race.winner_time) : '--';
        const isPilotHistory = race.pilot_position !== undefined;

        return `
            <div style="border-radius: 12px; padding: 1rem; margin-bottom: 1rem; border-left: 4px solid ${isPilotHistory && race.pilot_position === 1 ? '#ffd700' : (race.winner_name ? '#ffd700' : '#2a2f3a')};">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
                    <div style="flex: 1;">
                        <div style="font-weight: bold; font-size: 1.1rem; color: #ffd700;">${escapeHtml(race.circuit_name)}</div>
                        <div style="font-size: 0.7rem; color: #888; margin-top: 0.2rem;">
                            ${modeLabel} | ${race.laps_limit} vueltas | ${race.total_drivers || 0} pilotos | ID: ${race.id}
                        </div>
                        <div style="font-size: 0.7rem; color: #666;">📅 ${race.end_time_formatted || '--'}</div>
                        <div style="font-size: 0.8rem; color: #00c853; margin-top: 0.3rem;">
                            🏆 Ganador: <strong style="color: #ffd700;">${winner}</strong> 
                            ${winnerTime !== '--' ? `(${winnerTime})` : ''}
                        </div>
                        ${isPilotHistory ? `
                            <div style="font-size: 0.8rem; color: #4fc3f7; margin-top: 0.2rem;">
                                🏁 Posición del piloto: <strong style="color: #ffd700;">${race.pilot_position}</strong> | 
                                🏎️ Vueltas: <strong>${race.pilot_laps}</strong> | 
                                ⏱️ Mejor vuelta: <strong>${race.pilot_best_lap ? formatRaceClock(race.pilot_best_lap) : '--'}</strong>
                            </div>
                            <div style="font-size: 0.7rem; color: #888; margin-top: 0.2rem;">
                                👤 Piloto: ${race.pilot_name || '--'}
                            </div>
                        ` : ''}
                    </div>
                    <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                        <button class="btn btn-sm" onclick="viewRaceDetail(${race.id})" style="background: #2196f3;">📋 Ver detalles</button>
                        ${!isPilotHistory ? `<button class="btn btn-sm" onclick="deleteRaceHistory(${race.id}, '${escapeHtml(race.circuit_name)}')" style="background: #e5484d;">🗑️ Eliminar</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}











restoreLoginAfterReload().then(() => {
    checkAuth();
});


// ============================================================
// DIAGNÓSTICO DEL MENÚ RESPONSIVE
// ============================================================
setTimeout(() => {
    console.log("🔍 DIAGNÓSTICO DEL MENÚ RESPONSIVE:");
    console.log("🔍 loginBtnMobile:", document.getElementById('loginBtnMobile'));
    console.log("🔍 logoutBtnMobile:", document.getElementById('logoutBtnMobile'));
    console.log("🔍 userStatusMobile:", document.getElementById('userStatusMobile'));
    console.log("🔍 isAuthenticated:", isAuthenticated);
    console.log("🔍 currentUser:", currentUser);
}, 1000);





async function loadPilotHistoryList(searchTerm = '') {
    const grid = document.getElementById('historyPilotGrid');
    if (!grid) return;

    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: #888;">🔍 Cargando pilotos...</div>';

    try {
        // Obtener todos los pilotos
        const drivers = await apiCall('/api/drivers');
        if (!drivers || drivers.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: #888;">No hay pilotos registrados</div>';
            document.getElementById('historyPilotCount').innerText = '0 pilotos encontrados';
            return;
        }

        // Filtrar por búsqueda
        let filtered = drivers;
        if (searchTerm && searchTerm.trim() !== '') {
            const term = searchTerm.toLowerCase().trim();
            filtered = drivers.filter(d =>
                (d.name || '').toLowerCase().includes(term) ||
                (d.lastname || '').toLowerCase().includes(term) ||
                String(d.id).includes(term) ||
                String(d.transponder_id || '').includes(term) ||
                (d.email || '').toLowerCase().includes(term)
            );
        }

        // Ordenar por nombre
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Guardar datos para paginación
        pilotHistoryData = filtered;
        document.getElementById('historyPilotCount').innerText = `${filtered.length} pilotos encontrados`;

        // Paginar
        const totalPages = Math.ceil(filtered.length / pilotHistoryPageSize);
        const startIdx = (pilotHistoryCurrentPage - 1) * pilotHistoryPageSize;
        const pageData = filtered.slice(startIdx, startIdx + pilotHistoryPageSize);

        if (pageData.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: #ff9800;">No se encontraron pilotos con ese criterio</div>';
            return;
        }

        // Obtener estadísticas de cada piloto
        const history = await apiCall('/api/race/history');
        const pilotStats = {};

        if (history && history.length > 0) {
            for (const race of history) {
                const detail = await apiCall(`/api/race/history/${race.id}`);
                if (detail && detail.leaderboard) {
                    for (const d of detail.leaderboard) {
                        const driverId = d.driver_id;
                        if (!pilotStats[driverId]) {
                            pilotStats[driverId] = { races: 0, wins: 0, bestPos: Infinity, bestLap: Infinity };
                        }
                        pilotStats[driverId].races++;
                        if (d.position === 1) pilotStats[driverId].wins++;
                        if (d.position < pilotStats[driverId].bestPos) pilotStats[driverId].bestPos = d.position;
                        if (d.best_lap && d.best_lap < pilotStats[driverId].bestLap) {
                            pilotStats[driverId].bestLap = d.best_lap;
                        }
                    }
                }
            }
        }

        // Renderizar tarjetas
        grid.innerHTML = pageData.map(driver => {
            const stats = pilotStats[driver.id] || { races: 0, wins: 0, bestPos: '--', bestLap: '--' };
            const photo = driver.photo && driver.photo !== 'default-avatar.png'
                ? `/static/uploads/drivers/${driver.photo}`
                : '/static/default-avatar.png';

            const fullName = `${driver.name || ''} ${driver.lastname || ''}`.trim() || 'Sin nombre';
            const bestPosDisplay = stats.bestPos === Infinity ? '--' : stats.bestPos;
            const bestLapDisplay = stats.bestLap === Infinity ? '--' : formatRaceClock(stats.bestLap);

            return `
                <div class="pilot-history-card" onclick="showPilotDetail(${driver.id})" 
                     style="background: #0f1117; border: 1px solid #2a2f3a; border-radius: 12px; padding: 1rem; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; align-items: center; text-align: center;"
                     onmouseover="this.style.borderColor='#ffd700'; this.style.transform='translateY(-3px)';"
                     onmouseout="this.style.borderColor='#2a2f3a'; this.style.transform='translateY(0)';">
                    <img src="${photo}" style="width: 70px; height: 70px; border-radius: 50%; object-fit: cover; border: 3px solid #ffd700; margin-bottom: 0.5rem;" onerror="this.src='/static/default-avatar.png'">
                    <div style="font-weight: 600; font-size: 1rem; color: #fff; margin-bottom: 0.2rem;">${fullName}</div>
                    <div style="font-size: 0.7rem; color: #888;">ID: ${driver.id} ${driver.transponder_id ? `| Transp: ${driver.transponder_id}` : ''}</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem; width: 100%;">
                        <div><span style="font-size:0.6rem; color:#888;">🏁</span><br><strong style="color:#ffd700;">${stats.races}</strong></div>
                        <div><span style="font-size:0.6rem; color:#888;">🏆</span><br><strong style="color:#ffd700;">${stats.wins}</strong></div>
                        <div><span style="font-size:0.6rem; color:#888;">🥇</span><br><strong style="color:#ffd700;">${bestPosDisplay}</strong></div>
                    </div>
                    <div style="font-size:0.65rem; color:#888; margin-top:0.3rem;">⚡ Mejor vuelta: ${bestLapDisplay}</div>
                    <div style="margin-top: 0.5rem; font-size:0.7rem; color:#2196f3;">👆 Clic para ver carreras</div>
                </div>
            `;
        }).join('');

        // Renderizar paginación
        renderPilotPagination(totalPages);

    } catch (e) {
        console.error('Error cargando historial de pilotos:', e);
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: #e5484d;">❌ Error al cargar pilotos</div>';
    }
}

function renderPilotPagination(totalPages) {
    const container = document.getElementById('historyPilotPagination');
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    const current = pilotHistoryCurrentPage;

    // Anterior
    html += `<button class="btn btn-sm" onclick="goToPilotPage(${current - 1})" ${current <= 1 ? 'disabled' : ''} style="background: #2a2f3a;">◀</button>`;

    // Números
    const maxVisible = 5;
    let start = Math.max(1, current - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);

    if (end - start < maxVisible - 1) {
        start = Math.max(1, end - maxVisible + 1);
    }

    if (start > 1) {
        html += `<button class="btn btn-sm" onclick="goToPilotPage(1)" style="background: #2a2f3a;">1</button>`;
        if (start > 2) html += `<span style="color:#888;">...</span>`;
    }

    for (let i = start; i <= end; i++) {
        html += `<button class="btn btn-sm" onclick="goToPilotPage(${i})" style="background: ${i === current ? '#2196f3' : '#2a2f3a'}; ${i === current ? 'font-weight:bold;' : ''}">${i}</button>`;
    }

    if (end < totalPages) {
        if (end < totalPages - 1) html += `<span style="color:#888;">...</span>`;
        html += `<button class="btn btn-sm" onclick="goToPilotPage(${totalPages})" style="background: #2a2f3a;">${totalPages}</button>`;
    }

    // Siguiente
    html += `<button class="btn btn-sm" onclick="goToPilotPage(${current + 1})" ${current >= totalPages ? 'disabled' : ''} style="background: #2a2f3a;">▶</button>`;

    container.innerHTML = html;
}

function goToPilotPage(page) {
    const totalPages = Math.ceil(pilotHistoryData.length / pilotHistoryPageSize);
    if (page < 1 || page > totalPages) return;
    pilotHistoryCurrentPage = page;
    const searchTerm = document.getElementById('historyPilotSearch')?.value || '';
    loadPilotHistoryList(searchTerm);
}

// ============================================================
// DETALLE DE PILOTO (MODAL)
// ============================================================

async function showPilotDetail(driverId) {
    const modal = document.getElementById('pilotDetailModal');
    if (!modal) return;

    modal.style.display = 'flex';

    try {
        // Obtener datos del piloto
        const drivers = await apiCall('/api/drivers');
        const driver = drivers?.find(d => d.id === driverId);
        if (!driver) {
            showToast('❌', 'Piloto no encontrado', 'error');
            modal.style.display = 'none';
            return;
        }

        // Actualizar header
        const photo = driver.photo && driver.photo !== 'default-avatar.png'
            ? `/static/uploads/drivers/${driver.photo}`
            : '/static/default-avatar.png';
        document.getElementById('pilotDetailPhoto').src = photo;
        document.getElementById('pilotDetailName').innerText = `${driver.name || ''} ${driver.lastname || ''}`.trim() || 'Sin nombre';
        document.getElementById('pilotDetailMeta').innerText = `ID: ${driver.id} | Transponder: ${driver.transponder_id || '--'}`;

        // Obtener carreras del piloto
        const history = await apiCall('/api/race/history');
        let pilotRaces = [];
        let totalWins = 0;
        let bestPos = Infinity;
        let bestLap = Infinity;

        if (history && history.length > 0) {
            for (const race of history) {
                const detail = await apiCall(`/api/race/history/${race.id}`);
                if (detail && detail.leaderboard) {
                    const pilotData = detail.leaderboard.find(d => d.driver_id === driverId);
                    if (pilotData) {
                        pilotRaces.push({
                            race: race,
                            position: pilotData.position,
                            laps: pilotData.total_laps || 0,
                            bestLap: pilotData.best_lap,
                            totalTime: pilotData.total_time,
                            isWinner: pilotData.position === 1
                        });
                        if (pilotData.position === 1) totalWins++;
                        if (pilotData.position < bestPos) bestPos = pilotData.position;
                        if (pilotData.best_lap && pilotData.best_lap < bestLap) {
                            bestLap = pilotData.best_lap;
                        }
                    }
                }
            }
        }

        // Ordenar carreras por fecha (más reciente primero)
        pilotRaces.sort((a, b) => {
            const dateA = new Date(a.race.end_time || 0);
            const dateB = new Date(b.race.end_time || 0);
            return dateB - dateA;
        });

        // Actualizar estadísticas
        document.getElementById('pilotDetailRaces').innerText = pilotRaces.length;
        document.getElementById('pilotDetailWins').innerText = totalWins;
        document.getElementById('pilotDetailBestPos').innerText = bestPos === Infinity ? '--' : bestPos;
        document.getElementById('pilotDetailBestLap').innerText = bestLap === Infinity ? '--' : formatRaceClock(bestLap);

        // Renderizar carreras
        const listContainer = document.getElementById('pilotDetailRacesList');
        if (pilotRaces.length === 0) {
            listContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: #888;">Este piloto no ha participado en ninguna carrera</div>';
        } else {
            listContainer.innerHTML = pilotRaces.map((item, idx) => {
                const race = item.race;
                const date = race.end_time ? race.end_time.replace('T', ' ').slice(0, 19) : '--';
                const winnerTag = item.isWinner ? ' 🏆' : '';
                const posColor = item.position === 1 ? '#ffd700' : item.position === 2 ? '#c0c0c0' : item.position === 3 ? '#cd7f32' : '#fff';
                const bestLapDisplay = item.bestLap ? formatRaceClock(item.bestLap) : '--';
                const totalTimeDisplay = item.totalTime ? formatRaceClock(item.totalTime) : '--';

                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.7rem; border-bottom: 1px solid #2a2f3a; flex-wrap: wrap; gap: 0.5rem;">
                        <div style="flex: 1; min-width: 150px;">
                            <div style="font-weight: 600; color: #fff;">${race.circuit_name || 'Carrera sin nombre'}${winnerTag}</div>
                            <div style="font-size: 0.7rem; color: #888;">📅 ${date}</div>
                        </div>
                        <div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
                            <div style="text-align: center;">
                                <span style="font-size:0.6rem; color:#888;">Pos</span>
                                <div style="font-weight: bold; color: ${posColor}; font-size: 1.1rem;">#${item.position}</div>
                            </div>
                            <div style="text-align: center;">
                                <span style="font-size:0.6rem; color:#888;">Vueltas</span>
                                <div style="font-weight: bold; color: #fff;">${item.laps}</div>
                            </div>
                            <div style="text-align: center;">
                                <span style="font-size:0.6rem; color:#888;">Mejor Vta</span>
                                <div style="font-weight: bold; color: #ffd700; font-family: monospace;">${bestLapDisplay}</div>
                            </div>
                            <div style="text-align: center;">
                                <span style="font-size:0.6rem; color:#888;">Tiempo Total</span>
                                <div style="font-weight: bold; color: #fff; font-family: monospace;">${totalTimeDisplay}</div>
                            </div>
                            <button class="btn btn-sm" onclick="viewRaceDetail(${race.id})" style="background: #2196f3;">📋 Ver</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

    } catch (e) {
        console.error('Error cargando detalle del piloto:', e);
        showToast('❌', 'Error al cargar detalles del piloto', 'error');
        modal.style.display = 'none';
    }
}

// Cerrar modal de detalle de piloto
document.getElementById('closePilotDetailBtn')?.addEventListener('click', () => {
    document.getElementById('pilotDetailModal').style.display = 'none';
});

document.getElementById('pilotDetailModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('pilotDetailModal')) {
        document.getElementById('pilotDetailModal').style.display = 'none';
    }
});

// ============================================================
// CONFIGURACIÓN DE EVENTOS PARA HISTORIAL DE PILOTOS
// ============================================================

function setupPilotHistoryEvents() {
    const searchInput = document.getElementById('historyPilotSearch');
    const searchBtn = document.getElementById('historyPilotSearchBtn');
    const clearBtn = document.getElementById('historyPilotClearBtn');
    const refreshBtn = document.getElementById('refreshHistoryBtn');
    const pageSizeSelect = document.getElementById('historyPilotPageSize');

    if (searchBtn) {
        searchBtn.onclick = () => {
            pilotHistoryCurrentPage = 1;
            loadPilotHistoryList(searchInput?.value || '');
        };
    }

    if (clearBtn) {
        clearBtn.onclick = () => {
            if (searchInput) searchInput.value = '';
            pilotHistoryCurrentPage = 1;
            loadPilotHistoryList('');
        };
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                pilotHistoryCurrentPage = 1;
                loadPilotHistoryList(searchInput.value);
            }
        });
    }

    if (refreshBtn) {
        refreshBtn.onclick = () => {
            pilotHistoryCurrentPage = 1;
            loadPilotHistoryList(searchInput?.value || '');
            showToast('🔄', 'Historial actualizado', 'info');
        };
    }

    if (pageSizeSelect) {
        pageSizeSelect.onchange = () => {
            pilotHistoryPageSize = parseInt(pageSizeSelect.value);
            pilotHistoryCurrentPage = 1;
            loadPilotHistoryList(searchInput?.value || '');
        };
    }
}

// Inicializar historial de pilotos al cargar el panel
document.addEventListener('DOMContentLoaded', function () {
    setupPilotHistoryEvents();

    // Escuchar cuando se active el panel de historial
    const historyLink = document.querySelector('[data-panel="history"]');
    if (historyLink) {
        historyLink.addEventListener('click', function () {
            setTimeout(() => {
                const searchTerm = document.getElementById('historyPilotSearch')?.value || '';
                loadPilotHistoryList(searchTerm);
            }, 300);
        });
    }
});



async function showWinnerForAllModes() {
    const podiumRes = await apiCall('/api/session/current/podium');
    const podium = podiumRes?.podium || [];
    const raceMode = normalizeRaceMode(podiumRes?.race_mode || 'position');
    currentRaceMode = raceMode;

    // ✅ VERIFICAR SI HAY PODIO
    if (podium.length === 0 && raceMode !== 'classification') {
        showToast('⚠️', 'No hay ganadores para mostrar', 'warning');
        return;
    }

    // ✅ Para CLASSIFICATION: verificar que haya grupos
    if (raceMode === 'classification') {
        const groups = podiumRes?.classification_groups;
        if (!groups || (!groups.q1?.length && !groups.q2?.length && !groups.q3?.length && !groups.dnq?.length)) {
            showToast('⚠️', 'No hay datos de clasificación', 'warning');
            return;
        }

        // ✅ MOSTRAR CLASIFICACIÓN (MANUAL = true)
        resetWinnerModalFlag();
        showClassificationModal(groups.q1, groups.q2, groups.q3, groups.dnq, true);
        return;
    }

    // ✅ PARA OTROS MODOS: mostrar podium (MANUAL = true)
    if (podium.length === 0) {
        showToast('⚠️', 'No hay ganadores para mostrar', 'warning');
        return;
    }

    resetWinnerModalFlag();
    showWinnerModalComplete(podium[0], podium[1], podium[2], true);
}

// Reemplazar el onclick del botón
document.getElementById('showWinnerBtn').onclick = showWinnerForAllModes;
document.getElementById('showClassificationBtn').onclick = showWinnerForAllModes;


// ✅ MODIFICAR window.editDriverMinimal para soportar foto
window.editDriverMinimal = (id, name, lastname, transponder, email, carnet, phone, photo) => {
    const modal = document.getElementById('editDriverMinimalModal');
    if (!modal) return;

    document.getElementById('editDriverNameInput').value = name;
    document.getElementById('editDriverLastnameInput').value = lastname;
    document.getElementById('editDriverTransponderInput').value = transponder || '';

    // Guardar datos para la confirmación
    window._editingDriverId = id;
    window._editingDriverData = { name, lastname, transponder, email, carnet, phone, photo };

    // Mostrar foto actual
    const photoPreview = document.getElementById('editDriverPhotoPreview');
    if (photoPreview) {
        const photoUrl = photo && photo !== 'default-avatar.png'
            ? `/static/uploads/drivers/${photo}`
            : '/static/default-avatar.png';
        photoPreview.src = photoUrl;
    }

    modal.style.display = 'flex';
};

// ✅ MODIFICAR confirmación del modal de piloto
document.getElementById('editDriverMinimalConfirm').onclick = async () => {
    const id = window._editingDriverId;
    if (!id) return;

    const newName = document.getElementById('editDriverNameInput').value.trim();
    const newLastname = document.getElementById('editDriverLastnameInput').value.trim();
    const newTransponder = parseInt(document.getElementById('editDriverTransponderInput').value);

    if (!newName) {
        showToast('❌', 'El nombre es obligatorio', 'error');
        return;
    }

    showLoader('Actualizando piloto...');

    // Actualizar datos básicos
    const res = await apiCall(`/api/drivers/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
            name: newName,
            lastname: newLastname,
            transponder_id: isNaN(newTransponder) ? null : newTransponder,
            email: window._editingDriverData?.email || '',
            carnet: window._editingDriverData?.carnet || '',
            phone: window._editingDriverData?.phone || ''
        })
    });

    hideLoader();

    if (res?.success) {
        showToast('✅', 'Piloto actualizado', 'success');
        loadDrivers();
        loadTransponders();
        document.getElementById('editDriverMinimalModal').style.display = 'none';
    } else {
        showToast('❌', res?.error || 'Error al actualizar', 'error');
    }
};


document.addEventListener('DOMContentLoaded', function () {
    loadWinnerConfig();
    setupWinnerConfigControls();
    loadColumnsConfig();
    setupColumnsConfigControls();
});

// ============================================================
// CONFIGURACIÓN DE COLUMNAS DEL TABLERO
// ============================================================

const COLUMNS_CONFIG = [
    { id: 'pos', label: 'Pos', class: 'k-col-pos', defaultDesktop: true, defaultMobile: true },
    { id: 'vueltas', label: 'Vueltas', class: 'k-col-vueltas', defaultDesktop: true, defaultMobile: true },
    { id: 'dif', label: 'Dif.', class: 'k-col-dif', defaultDesktop: true, defaultMobile: false },
    { id: 'mejor', label: 'Mejor', class: 'k-col-mejor', defaultDesktop: true, defaultMobile: false },
    { id: 'tiempo', label: 'Tiempo', class: 'k-col-tiempo', defaultDesktop: true, defaultMobile: false },
    { id: 'ttotal', label: 'T.Total', class: 'k-col-tiempo-individual', defaultDesktop: true, defaultMobile: false },
    { id: 'vel', label: 'Vel.', class: 'k-col-velocidad', defaultDesktop: true, defaultMobile: false },
    { id: 'kart', label: 'Kart', class: 'k-col-kart', defaultDesktop: true, defaultMobile: false }
];


async function loadColumnsConfig() {
    try {
        // ✅ Usar endpoint GLOBAL (sin autenticación)
        const res = await apiCall('/api/columns/config');
        if (res && res.success) {
            columnsConfig.desktop = res.desktop || [];
            columnsConfig.mobile = res.mobile || [];
        } else {
            // Fallback: mostrar todo
            columnsConfig.desktop = [];
            columnsConfig.mobile = [];
        }
        applyColumnsConfig();
        renderColumnsConfigTable();
    } catch (e) {
        console.warn('Error cargando configuración de columnas:', e);
        columnsConfig.desktop = [];
        columnsConfig.mobile = [];
        applyColumnsConfig();
        renderColumnsConfigTable();
    }
}

function applyColumnsConfig() {
    // ✅ DETECTAR SI ES MÓVIL
    const isMobile = isMobileDevice();
    const hiddenColumns = isMobile ? columnsConfig.mobile : columnsConfig.desktop;

    // Si no hay columnas ocultas, mostrar todo
    if (!hiddenColumns || hiddenColumns.length === 0) {
        mostrarTodasLasColumnas();
        return;
    }

    // Aplicar a todos los paneles que usan columnas
    const panels = ['tableroPublico', 'live'];

    panels.forEach(panelId => {
        const panel = document.getElementById(`panel-${panelId}`);
        if (!panel) return;

        // ✅ 1. HEADER
        COLUMNS_CONFIG.forEach(col => {
            const headers = panel.querySelectorAll(`.k-header .${col.class}`);
            headers.forEach(el => {
                if (hiddenColumns.includes(col.id)) {
                    el.style.display = 'none';
                } else {
                    el.style.display = '';
                }
            });
        });

        // ✅ 2. FILAS
        const selectores = ['#lista-pilotos', '#liveLeaderboardPublicStyle', '.karting-leaderboard'];
        selectores.forEach(selector => {
            const container = panel.querySelector(selector);
            if (container) {
                const rows = container.querySelectorAll('.k-row');
                rows.forEach(row => {
                    COLUMNS_CONFIG.forEach(col => {
                        const cells = row.querySelectorAll(`.${col.class}`);
                        cells.forEach(el => {
                            if (hiddenColumns.includes(col.id)) {
                                el.style.display = 'none';
                            } else {
                                // ✅ IMPORTANTE: Restaurar display según el contexto
                                if (col.id === 'ttotal' && isMobile) {
                                    // En móvil, si está visible, usar block
                                    el.style.display = 'block';
                                } else if (col.id === 'ttotal') {
                                    el.style.display = 'flex';
                                } else {
                                    el.style.display = '';
                                }
                            }
                        });
                    });
                });
            }
        });
    });
}


function mostrarTodasLasColumnas() {
    const panels = ['tableroPublico', 'live'];
    const isMobile = isMobileDevice();

    panels.forEach(panelId => {
        const panel = document.getElementById(`panel-${panelId}`);
        if (!panel) return;

        // Mostrar todos los headers
        COLUMNS_CONFIG.forEach(col => {
            const headers = panel.querySelectorAll(`.k-header .${col.class}`);
            headers.forEach(el => {
                el.style.display = '';
            });
        });

        // Mostrar todas las celdas
        const selectores = ['#lista-pilotos', '#liveLeaderboardPublicStyle', '.karting-leaderboard'];
        selectores.forEach(selector => {
            const container = panel.querySelector(selector);
            if (container) {
                const rows = container.querySelectorAll('.k-row');
                rows.forEach(row => {
                    COLUMNS_CONFIG.forEach(col => {
                        const cells = row.querySelectorAll(`.${col.class}`);
                        cells.forEach(el => {
                            // ✅ Restaurar display según el contexto
                            if (col.id === 'ttotal' && isMobile) {
                                el.style.display = 'block';
                            } else if (col.id === 'ttotal') {
                                el.style.display = 'flex';
                            } else {
                                el.style.display = '';
                            }
                        });
                    });
                });
            }
        });
    });
}

function renderColumnsConfigTable() {
    const tbody = document.getElementById('columnsConfigTableBody');
    if (!tbody) return;

    // Verificar si la card está visible
    const configCard = document.getElementById('columnsConfigCard');
    if (configCard && configCard.style.display === 'none') {
        return;
    }


    // Columnas que NO son "Nombre" (siempre visible)
    const configurableColumns = COLUMNS_CONFIG.filter(col => col.id !== 'nombre');

    tbody.innerHTML = configurableColumns.map(col => {
        const isHiddenDesktop = columnsConfig.desktop.includes(col.id);
        const isHiddenMobile = columnsConfig.mobile.includes(col.id);

        return `
            <tr style="border-bottom: 1px solid #1a1e26;">
                <td style="padding: 0.5rem 0.6rem; font-size: 0.8rem; color: #e4e4e4; font-weight: 500;">
                    ${col.label}
                </td>
                <td style="padding: 0.5rem 0.6rem; text-align: center;">
                    <label style="display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer;">
                        <input type="checkbox" class="col-checkbox-desktop" data-col-id="${col.id}" 
                               ${isHiddenDesktop ? '' : 'checked'}
                               style="width: 16px; height: 16px; accent-color: #34d399; cursor: pointer;">
                        <span style="font-size: 0.65rem; color: #34d399;">${isHiddenDesktop ? 'Oculto' : 'Visible'}</span>
                    </label>
                </td>
                <td style="padding: 0.5rem 0.6rem; text-align: center;">
                    <label style="display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer;">
                        <input type="checkbox" class="col-checkbox-mobile" data-col-id="${col.id}" 
                               ${isHiddenMobile ? '' : 'checked'}
                               style="width: 16px; height: 16px; accent-color: #4fc3f7; cursor: pointer;">
                        <span style="font-size: 0.65rem; color: #4fc3f7;">${isHiddenMobile ? 'Oculto' : 'Visible'}</span>
                    </label>
                </td>
            </tr>
        `;
    }).join('');

    // ✅ Agregar eventos para actualizar el texto al hacer clic
    document.querySelectorAll('.col-checkbox-desktop').forEach(cb => {
        cb.addEventListener('change', function () {
            const label = this.closest('label').querySelector('span');
            if (label) {
                label.textContent = this.checked ? 'Visible' : 'Oculto';
            }
        });
    });

    document.querySelectorAll('.col-checkbox-mobile').forEach(cb => {
        cb.addEventListener('change', function () {
            const label = this.closest('label').querySelector('span');
            if (label) {
                label.textContent = this.checked ? 'Visible' : 'Oculto';
            }
        });
    });
}

function setupColumnsConfigControls() {
    const saveBtn = document.getElementById('saveColumnsConfigBtn');
    const selectAllBtn = document.getElementById('selectAllColumnsBtn');
    const deselectAllBtn = document.getElementById('deselectAllColumnsBtn');
    const statusSpan = document.getElementById('columnsConfigStatus');

    // ============================================================
    // 1. SELECCIONAR TODAS (Escritorio y Móvil)
    // ============================================================
    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            document.querySelectorAll('.col-checkbox-desktop, .col-checkbox-mobile').forEach(cb => {
                cb.checked = true;
            });
            // Actualizar textos
            document.querySelectorAll('.col-checkbox-desktop').forEach(cb => {
                const label = cb.closest('label').querySelector('span');
                if (label) label.textContent = 'Visible';
            });
            document.querySelectorAll('.col-checkbox-mobile').forEach(cb => {
                const label = cb.closest('label').querySelector('span');
                if (label) label.textContent = 'Visible';
            });
        };
    }

    // ============================================================
    // 2. DESELECCIONAR TODAS (Escritorio y Móvil)
    // ============================================================
    if (deselectAllBtn) {
        deselectAllBtn.onclick = () => {
            document.querySelectorAll('.col-checkbox-desktop, .col-checkbox-mobile').forEach(cb => {
                cb.checked = false;
            });
            // Actualizar textos
            document.querySelectorAll('.col-checkbox-desktop').forEach(cb => {
                const label = cb.closest('label').querySelector('span');
                if (label) label.textContent = 'Oculto';
            });
            document.querySelectorAll('.col-checkbox-mobile').forEach(cb => {
                const label = cb.closest('label').querySelector('span');
                if (label) label.textContent = 'Oculto';
            });
        };
    }

    // ============================================================
    // 3. GUARDAR CONFIGURACIÓN
    // ============================================================
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const desktopCheckboxes = document.querySelectorAll('.col-checkbox-desktop');
            const hiddenDesktop = [];
            desktopCheckboxes.forEach(cb => {
                if (!cb.checked) {
                    hiddenDesktop.push(cb.dataset.colId);
                }
            });

            const mobileCheckboxes = document.querySelectorAll('.col-checkbox-mobile');
            const hiddenMobile = [];
            mobileCheckboxes.forEach(cb => {
                if (!cb.checked) {
                    hiddenMobile.push(cb.dataset.colId);
                }
            });

            if (statusSpan) {
                statusSpan.innerText = '⏳ Guardando...';
                statusSpan.style.color = '#ffaa00';
            }

            try {
                const token = sessionToken || localStorage.getItem('chronit_session_token');

                // ✅ Verificar autenticación para guardar
                if (!token) {
                    showToast('⚠️', 'Inicia sesión como desarrollador para guardar configuración', 'warning');
                    if (statusSpan) {
                        statusSpan.innerText = '❌ No autorizado';
                        statusSpan.style.color = '#ef7a86';
                    }
                    return;
                }

                // ✅ Usar endpoint GLOBAL pero con token para autorización
                const response = await fetch('/api/columns/config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Session-Token': token
                    },
                    body: JSON.stringify({
                        desktop: hiddenDesktop,
                        mobile: hiddenMobile
                    })
                });

                const data = await response.json();

                if (data.success) {
                    columnsConfig.desktop = hiddenDesktop;
                    columnsConfig.mobile = hiddenMobile;

                    if (statusSpan) {
                        statusSpan.innerText = '✅ Guardado';
                        statusSpan.style.color = '#34d399';
                        setTimeout(() => { statusSpan.innerText = 'Listo'; }, 3000);
                    }

                    applyColumnsConfig();
                    showToast('✅', 'Configuración guardada correctamente', 'success');
                } else {
                    if (statusSpan) {
                        statusSpan.innerText = '❌ ' + (data.error || 'Error');
                        statusSpan.style.color = '#ef7a86';
                    }
                    showToast('❌', data.error || 'Error al guardar', 'error');
                }
            } catch (e) {
                console.error('Error guardando configuración:', e);
                if (statusSpan) {
                    statusSpan.innerText = '❌ Error';
                    statusSpan.style.color = '#ef7a86';
                }
                showToast('❌', 'Error al conectar con el servidor', 'error');
            }
        };
    }

    // ============================================================
    // 4. INICIALIZACIÓN
    // ============================================================

}

// ============================================================
// DETECTAR DISPOSITIVO MÓVIL
// ============================================================

function isMobileDevice() {
    // ✅ 1. Detectar por ancho de pantalla
    if (window.innerWidth <= 768) {
        return true;
    }

    // ✅ 2. Detectar por user agent
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    if (/android|iPad|iPhone|iPod|BlackBerry|Windows Phone|webOS|Mobile/i.test(ua)) {
        return true;
    }

    // ✅ 3. Detectar por touch events y pantalla pequeña
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        if (window.innerWidth <= 1024) {
            return true;
        }
    }

    return false;
}

window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
        // Solo aplicar si está en modo automático
        if (!localStorage.getItem('chronit_columns_mode')) {
            const isMobile = isMobileDevice();
            const newMode = isMobile ? 'mobile' : 'desktop';
            if (columnsMode !== newMode) {
                columnsMode = newMode;
                applyColumnsConfig();
                const label = document.getElementById('columnsModeLabel');
                if (label) {
                    label.textContent = isMobile ? '(Móvil - Auto)' : '(Escritorio - Auto)';
                }
            }
        }
    }, 500);
}

);