// Función para normalizar nombres y evitar duplicados por Vila-Real / Vila Real
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

async function cargarDatosGTFS() {
    try {
        const [routes, trips, stops, stopTimes, shapes] = await Promise.all([
            fetch('gtfs/routes.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/trips.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/stops.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/stop_times.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/shapes.txt').then(r => r.text()).then(parsearCSV)
        ]);
        iniciarMapa(stops, stopTimes, trips, routes, shapes);
    } catch (e) {
        console.error("Error cargando archivos:", e);
    }
}

function iniciarMapa(stops, stopTimes, trips, routes, shapesArray) {
    const map = L.map('map').setView([39.9864, -0.0513], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    const clusterGroup = L.markerClusterGroup();
    const busIcon = L.divIcon({
        html: `<div style="background:#0078A8; border-radius:50%; width:24px; height:24px; border:2px solid white; display:flex; justify-content:center; align-items:center; color:white; font-size:12px;">🚌</div>`,
        className: '', iconSize: [24, 24], iconAnchor: [12, 12]
    });

    stops.forEach(stop => {
        const marker = L.marker([parseFloat(stop.stop_lat), parseFloat(stop.stop_lon)], { icon: busIcon });

        marker.on('click', function() {
            const ahora = new Date();
            
            // 1. Buscar horarios para esta parada
            const proximos = stopTimes
                .filter(st => st.stop_id === stop.stop_id)
                .map(st => {
                    const trip = trips.find(t => t.trip_id === st.trip_id);
                    const route = routes.find(r => r.route_id === trip?.route_id);
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
                        diffMin: Math.round(diff)
                    };
                })
                .filter(h => h && h.diffMin >= -1)
                .sort((a, b) => a.diffMin - b.diffMin);

            // 2. Quitar duplicados
            const vistos = new Set();
            const unicos = [];
            proximos.forEach(h => {
                const clave = `${h.linea}-${h.hora}-${normalizar(h.destino)}`;
                if (!vistos.has(clave)) {
                    vistos.add(clave);
                    unicos.push(h);
                }
            });

            // 3. Crear HTML
            let html = `<div class="popup-container"><strong>${stop.stop_name}</strong><br><hr>`;
            if (unicos.length === 0) {
                html += "No hay más servicios hoy.";
            } else {
                unicos.slice(0, 5).forEach(h => {
                    let tiempoTxt = h.diffMin < 60 
                        ? `<span class="${h.diffMin <= 1 ? 'parpadeo' : ''}">en ${Math.max(0, h.diffMin)} min</span>`
                        : h.hora;
                    
                    html += `<div style="margin-bottom:5px;">
                                <span class="linea-nombre">${h.linea}</span> 
                                <span class="destino-texto">${h.destino}</span>: 
                                <strong>${tiempoTxt}</strong>
                             </div>`;
                });
            }
            html += `</div>`;

            // 4. Vincular y abrir
            this.bindPopup(html).openPopup();
        });

        clusterGroup.addLayer(marker);
    });
    map.addLayer(clusterGroup);

    // Dibujar líneas de colores
    const shapesMap = shapesArray.reduce((acc, pt) => {
        (acc[pt.shape_id] = acc[pt.shape_id] || []).push(pt);
        return acc;
    }, {});

    Object.keys(shapesMap).forEach(shapeId => {
        const puntos = shapesMap[shapeId]
            .sort((a, b) => parseInt(a.shape_pt_sequence) - parseInt(b.shape_pt_sequence))
            .map(p => [parseFloat(p.shape_pt_lat), parseFloat(p.shape_pt_lon)]);

        const tripAsociado = trips.find(t => t.shape_id === shapeId);
        let colorRuta = '#3388ff';
        if (tripAsociado) {
            const ruta = routes.find(r => r.route_id === tripAsociado.route_id);
            if (ruta && ruta.route_color) colorRuta = `#${ruta.route_color.replace('#','')}`;
        }

        if (puntos.length > 0) {
            L.polyline(puntos, { color: colorRuta, weight: 4, opacity: 0.7 }).addTo(map);
        }
    });
}

cargarDatosGTFS();