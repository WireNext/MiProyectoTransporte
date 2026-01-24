/**
 * Normaliza textos para evitar duplicados por pequeñas variaciones 
 * como "Vila-Real" vs "Vila Real".
 */
const normalizar = (t) => t ? t.toLowerCase().replace(/[-]/g, ' ').trim() : '';

/**
 * Convierte el CSV de GTFS en un array de objetos.
 */
function parsearCSV(csvText) {
    if (!csvText) return [];
    const lineas = csvText.trim().split(/\r?\n/);
    if (lineas.length <= 1) return [];

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

/**
 * Carga todos los archivos necesarios de la carpeta /gtfs
 */
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
        console.error("Error cargando archivos GTFS:", e);
    }
}

function iniciarMapa(stops, stopTimes, trips, routes, shapesArray) {
    // Centrado inicial en Castellón
    const map = L.map('map').setView([39.9864, -0.0513], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    const clusterGroup = L.markerClusterGroup();
    const busIcon = L.divIcon({
        html: `<div style="background:#0078A8; border-radius:50%; width:24px; height:24px; border:2px solid white; display:flex; justify-content:center; align-items:center; color:white; font-size:12px;">🚌</div>`,
        className: '', iconSize: [24, 24], iconAnchor: [12, 12]
    });

    // 1. PROCESAR PARADAS Y POPUPS
    stops.forEach(stop => {
        const marker = L.marker([parseFloat(stop.stop_lat), parseFloat(stop.stop_lon)], { icon: busIcon });

        marker.on('click', () => {
            const ahora = new Date();
            
            // Filtrar y calcular tiempos para esta parada
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
                    if (diff < -120) diff += 1440; // Ajuste paso de medianoche

                    return {
                        linea: route.route_short_name,
                        destino: trip.trip_headsign,
                        hora: st.departure_time.substring(0, 5),
                        diffMin: Math.round(diff)
                    };
                })
                .filter(h => h && h.diffMin >= -1)
                .sort((a, b) => a.diffMin - b.diffMin);

            // ELIMINAR DUPLICADOS (Clave: Línea + Hora + Destino Normalizado)
            const vistos = new Set();
            const horariosUnicos = [];
            proximos.forEach(h => {
                const clave = `${h.linea}-${h.hora}-${normalizar(h.destino)}`;
                if (!vistos.has(clave)) {
                    vistos.add(clave);
                    horariosUnicos.push(h);
                }
            });

            // Generar HTML del Popup
            let html = `<strong>${stop.stop_name}</strong><br><ul style="list-style:none; padding:0; margin:5px 0 0 0;">`;
            
            horariosUnicos.slice(0, 5).forEach(h => {
                let textoTiempo = "";
                // REGLA: Menos de 60 min -> "en X min". Más de 60 -> "HH:MM"
                if (h.diffMin < 60) {
                    const clase = h.diffMin <= 1 ? 'style="color:red; font-weight:bold; animation: parpadeo 1s infinite;"' : '';
                    textoTiempo = `<span ${clase}>en ${Math.max(0, h.diffMin)} min</span>`;
                } else {
                    textoTiempo = h.hora;
                }
                
                html += `<li style="border-bottom:1px solid #eee; padding:3px 0;">
                            <b>${h.linea}</b> ${h.destino}: ${textoTiempo}
                         </li>`;
            });
            
            html += '</ul>';
            marker.setPopupContent(html).openPopup();
        });

        clusterGroup.addLayer(marker);
    });
    map.addLayer(clusterGroup);

    // 2. DIBUJAR LÍNEAS (SHAPES) CON COLOR DINÁMICO
    const shapesMap = shapesArray.reduce((acc, pt) => {
        (acc[pt.shape_id] = acc[pt.shape_id] || []).push(pt);
        return acc;
    }, {});

    Object.keys(shapesMap).forEach(shapeId => {
        const puntos = shapesMap[shapeId]
            .sort((a, b) => parseInt(a.shape_pt_sequence) - parseInt(b.shape_pt_sequence))
            .map(p => [parseFloat(p.shape_pt_lat), parseFloat(p.shape_pt_lon)]);

        // Buscar el color de la ruta
        const tripAsociado = trips.find(t => t.shape_id === shapeId);
        let colorRuta = '#3388ff'; // Azul por defecto

        if (tripAsociado) {
            const ruta = routes.find(r => r.route_id === tripAsociado.route_id);
            if (ruta && ruta.route_color) {
                const hex = ruta.route_color.replace('#', '');
                colorRuta = `#${hex}`;
            }
        }

        if (puntos.length > 0) {
            L.polyline(puntos, {
                color: colorRuta,
                weight: 4,
                opacity: 0.7
            }).addTo(map);
        }
    });
}

// Iniciar proceso
cargarDatosGTFS();