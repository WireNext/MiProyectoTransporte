// --- UTILIDADES ---
const normalizar = (t) => t ? t.toLowerCase().replace(/[-]/g, ' ').trim() : '';

function parsearCSV(csvText) {
    if (!csvText) return [];
    const lineas = csvText.trim().split(/\r?\n/);
    const cabeceras = lineas[0].split(',').map(h => h.trim());
    return lineas.slice(1).map(linea => {
        const valores = linea.split(',');
        const obj = {};
        cabeceras.forEach((h, i) => {
            obj[h] = valores[i] ? valores[i].trim().replace(/^"(.*)"$/, '$1') : '';
        });
        return obj;
    }).filter(o => Object.keys(o).length === cabeceras.length);
}

function obtenerServiciosActivos(calendar) {
    const diasSemana = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const ahora = new Date();
    const nombreDiaHoy = diasSemana[ahora.getDay()];
    const fechaActual = ahora.toISOString().slice(0, 10).replace(/-/g, '');
    return calendar.filter(s => s[nombreDiaHoy] === '1' && fechaActual >= s.start_date && fechaActual <= s.end_date).map(s => s.service_id);
}

const aMinutos = (horaStr) => {
    const [h, m] = horaStr.split(':').map(Number);
    return h * 60 + m;
};

const aHHMM = (minutosTotales) => {
    const h = Math.floor(minutosTotales / 60) % 24;
    const m = minutosTotales % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

// --- CONFIGURACIÓN DE REDES ---
const REDES = [
    { id: 'gva', nombre: 'Generalitat', folder: 'gtfs/gva' },
    { id: 'renfe', nombre: 'renfe', folder: 'gtfs/renfe' }
];

// --- MOTOR PRINCIPAL ---
async function cargarTodo() {
    const map = L.map('map').setView([39.9864, -0.0513], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    const clusterGroup = L.markerClusterGroup();

    // 1. Cargar incidencias globales
    let incidencias = { viajes_cancelados: [], paradas_omitidas: [], avisos_paradas: {} };
    try {
        const resp = await fetch('incidencias.json');
        if (resp.ok) incidencias = await resp.json();
    } catch (e) { console.warn("No se pudieron cargar las incidencias."); }

    // 2. Cargar cada red GTFS
    for (const red of REDES) {
        try {
            console.log(`Cargando datos de: ${red.nombre}`);
            const [routes, trips, stops, stopTimes, shapes, calendar, frequencies] = await Promise.all([
                fetch(`${red.folder}/routes.txt`).then(r => r.text()).then(parsearCSV),
                fetch(`${red.folder}/trips.txt`).then(r => r.text()).then(parsearCSV),
                fetch(`${red.folder}/stops.txt`).then(r => r.text()).then(parsearCSV),
                fetch(`${red.folder}/stop_times.txt`).then(r => r.text()).then(parsearCSV),
                fetch(`${red.folder}/shapes.txt`).then(r => r.text()).then(parsearCSV),
                fetch(`${red.folder}/calendar.txt`).then(r => r.text()).then(parsearCSV),
                fetch(`${red.folder}/frequencies.txt`).then(r => r.text()).then(parsearCSV).catch(() => []) 
            ]);

            const serviciosActivos = obtenerServiciosActivos(calendar);
            procesarRed(map, clusterGroup, red, { routes, trips, stops, stopTimes, shapes, serviciosActivos, incidencias, frequencies });

        } catch (error) {
            console.error(`Error cargando la red ${red.nombre}:`, error);
        }
    }

    map.addLayer(clusterGroup);
}

function procesarRed(map, clusterGroup, infoRed, data) {
    const { stops, stopTimes, trips, routes, shapes, serviciosActivos, incidencias, frequencies } = data;

    // Dibujar Paradas
    stops.forEach(stop => {
        const busIcon = L.divIcon({
            html: `<div style="background:#0078A8; border-radius:50%; width:24px; height:24px; border:2px solid white; display:flex; justify-content:center; align-items:center; color:white; font-size:12px;">🚌</div>`,
            className: '', iconSize: [24, 24]
        });

        const marker = L.marker([parseFloat(stop.stop_lat), parseFloat(stop.stop_lon)], { icon: busIcon });

        marker.on('click', () => {
            const ahora = new Date();
            const horaActualMin = ahora.getHours() * 60 + ahora.getMinutes();
            let horariosEncontrados = [];

            const misStopTimes = stopTimes.filter(st => st.stop_id === stop.stop_id);

            misStopTimes.forEach(st => {
                const trip = trips.find(t => t.trip_id === st.trip_id);
                if (!trip || !serviciosActivos.includes(trip.service_id)) return;

                const route = routes.find(r => r.route_id === trip.route_id);
                const freq = frequencies.find(f => f.trip_id === trip.trip_id);

                if (freq) {
                    const startMin = aMinutos(freq.start_time);
                    const endMin = aMinutos(freq.end_time);
                    const interval = parseInt(freq.headway_secs) / 60;
                    const offset = aMinutos(st.departure_time) - aMinutos(stopTimes.find(s => s.trip_id === st.trip_id && s.stop_sequence === "1").departure_time);

                    for (let t = startMin; t <= endMin; t += interval) {
                        const horaPaso = t + offset;
                        if (horaPaso >= horaActualMin - 2) {
                            horariosEncontrados.push({
                                trip_id: trip.trip_id,
                                linea: route.route_short_name,
                                destino: trip.trip_headsign,
                                hora: aHHMM(horaPaso),
                                diffMin: horaPaso - horaActualMin,
                                colorFondo: route.route_color ? `#${route.route_color.replace('#','')}` : '#3388ff',
                                colorTexto: route.route_text_color ? `#${route.route_text_color.replace('#','')}` : '#fff'
                            });
                        }
                    }
                } else {
                    const horaBusMin = aMinutos(st.departure_time);
                    if (horaBusMin >= horaActualMin - 2) {
                        horariosEncontrados.push({
                            trip_id: trip.trip_id,
                            linea: route.route_short_name,
                            destino: trip.trip_headsign,
                            hora: st.departure_time.substring(0, 5),
                            diffMin: horaBusMin - horaActualMin,
                            colorFondo: route.route_color ? `#${route.route_color.replace('#','')}` : '#3388ff',
                            colorTexto: route.route_text_color ? `#${route.route_text_color.replace('#','')}` : '#fff'
                        });
                    }
                }
            });

            // De-duplicar e Incidencias
            const unicos = [];
            const vistos = new Set();
            horariosEncontrados.sort((a, b) => a.diffMin - b.diffMin).forEach(h => {
                const clave = `${h.linea}-${h.hora}-${normalizar(h.destino)}`;
                if (!vistos.has(clave)) {
                    vistos.add(clave);
                    const cancelado = incidencias.viajes_cancelados?.find(v => v.trip_id === h.trip_id && (v.hora === h.hora || v.hora === "all"));
                    const omitida = incidencias.paradas_omitidas?.find(v => v.trip_id === h.trip_id && (v.stop_id === stop.stop_id || v.stop_id === "all"));
                    h.incidencia = cancelado || omitida;
                    unicos.push(h);
                }
            });

            // HTML del Popup
            let html = `<div style="min-width:220px;">
                <span class="tag-red">${infoRed.nombre}</span><br>
                <strong>${stop.stop_name}</strong><hr>`;
            
            if (incidencias.avisos_paradas[stop.stop_id]) {
                html += `<div style="background:#fff3cd; padding:5px; font-size:0.8em; margin-bottom:5px; border:1px solid #ffeeba;">⚠️ ${incidencias.avisos_paradas[stop.stop_id]}</div>`;
            }

            if (unicos.length === 0) html += "Sin servicios próximos.";
            else {
                unicos.slice(0, 5).forEach(h => {
                    const tLabel = (h.diffMin < 60 && !h.incidencia) ? `${Math.max(0, h.diffMin)} min` : h.hora;
                    html += `<div style="margin-bottom:8px;">
                        <span style="background:${h.colorFondo}; color:${h.colorTexto}; padding:2px 6px; border-radius:3px; font-weight:bold;">${h.linea}</span> 
                        <span style="font-size:0.85em;">${h.destino}</span>: 
                        <strong style="${h.incidencia ? 'text-decoration:line-through;color:red;' : ''}">${tLabel}</strong>
                    </div>`;
                });
            }
            html += `</div>`;
            L.popup().setLatLng(marker.getLatLng()).setContent(html).openOn(map);
        });

        clusterGroup.addLayer(marker);
    });

    // Dibujar Líneas (Shapes)
    const shapesMap = shapes.reduce((acc, pt) => {
        (acc[pt.shape_id] = acc[pt.shape_id] || []).push(pt);
        return acc;
    }, {});

    Object.keys(shapesMap).forEach(sId => {
        const pts = shapesMap[sId].sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence)
                                 .map(p => [parseFloat(p.shape_pt_lat), parseFloat(p.shape_pt_lon)]);
        const trip = trips.find(t => t.shape_id === sId);
        if (trip) {
            const route = routes.find(r => r.route_id === trip.route_id);
            const color = route?.route_color ? `#${route.route_color.replace('#','')}` : '#3388ff';
            L.polyline(pts, { color, weight: 3, opacity: 0.6 }).addTo(map);
        }
    });
}

// Iniciar aplicación
cargarTodo();