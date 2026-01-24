// Función para limpiar nombres y evitar duplicados por tildes o guiones
const normalizar = (t) => t.toLowerCase().replace(/[-]/g, ' ').trim();

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

async function cargarGTFS() {
    const files = ['routes', 'trips', 'stops', 'stop_times', 'shapes'];
    const [routes, trips, stops, stopTimes, shapes] = await Promise.all(
        files.map(f => fetch(`gtfs/${f}.txt`).then(r => r.text()).then(parsearCSV))
    );
    iniciarMapa(stops, stopTimes, trips, routes, shapes);
}

function iniciarMapa(stops, stopTimes, trips, routes, shapesArray) {
    const map = L.map('map').setView([39.9864, -0.0513], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    const cluster = L.markerClusterGroup();
    const busIcon = L.divIcon({
        html: `<div style="background:#0078A8;border-radius:50%;width:24px;height:24px;border:2px solid white;display:flex;justify-content:center;align-items:center;color:white;font-size:12px">🚌</div>`,
        className: '', iconSize: [24, 24]
    });

    stops.forEach(stop => {
        const marker = L.marker([parseFloat(stop.stop_lat), parseFloat(stop.stop_lon)], { icon: busIcon });
        
        marker.on('click', () => {
            const ahora = new Date();
            const rawHorarios = stopTimes
                .filter(st => st.stop_id === stop.stop_id)
                .map(st => {
                    const trip = trips.find(t => t.trip_id === st.trip_id);
                    const route = routes.find(r => r.route_id === (trip?.route_id));
                    if (!trip || !route) return null;

                    const [h, m, s] = st.departure_time.split(':').map(Number);
                    const dSalida = new Date(ahora);
                    dSalida.setHours(h, m, s);
                    let diff = (dSalida - ahora) / 60000;
                    if (diff < -120) diff += 1440;

                    return {
                        linea: route.route_short_name,
                        destino: trip.trip_headsign,
                        hora: st.departure_time.substring(0, 5),
                        diff: Math.round(diff)
                    };
                })
                .filter(h => h && h.diff >= -1)
                .sort((a, b) => a.diff - b.diff);

            // ELIMINAR DUPLICADOS (Si misma línea, misma hora y mismo destino aproximado)
            const filtrados = [];
            const visto = new Set();
            rawHorarios.forEach(h => {
                const idUnico = `${h.linea}-${h.hora}-${normalizar(h.destino)}`;
                if (!visto.has(idUnico)) {
                    visto.add(idUnico);
                    filtrados.push(h);
                }
            });

            let content = `<span class="popup-title">${stop.stop_name}</span>`;
            filtrados.slice(0, 5).forEach(h => {
                const tiempo = h.diff < 60 
                    ? `<span class="${h.diff <= 1 ? 'inminente' : ''}">en ${h.diff} min</span>` 
                    : h.hora;
                content += `
                    <div class="bus-row">
                        <span><span class="bus-line">${h.linea}</span> ${h.destino}</span>
                        <span class="tiempo">${tiempo}</span>
                    </div>`;
            });
            marker.setPopupContent(content || 'Sin servicios').openPopup();
        });
        cluster.addLayer(marker);
    });
    map.addLayer(cluster);

    // DIBUJAR LÍNEAS CON COLORES
    const shapesMap = shapesArray.reduce((acc, pt) => {
        (acc[pt.shape_id] = acc[pt.shape_id] || []).push(pt);
        return acc;
    }, {});

    Object.keys(shapesMap).forEach(sId => {
        const pts = shapesMap[sId].sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence)
                                  .map(p => [parseFloat(p.shape_pt_lat), parseFloat(p.shape_pt_lon)]);
        const trip = trips.find(t => t.shape_id === sId);
        const route = routes.find(r => r.route_id === trip?.route_id);
        let color = route?.route_color ? `#${route.route_color.replace('#','')}` : '#3388ff';

        L.polyline(pts, { color, weight: 4, opacity: 0.8 }).addTo(map);
    });
}

cargarGTFS();