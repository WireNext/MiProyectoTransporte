/**
 * @function parsearCSV
 * @description Convierte una cadena de texto GTFS (CSV) a un array de objetos.
 * Esta versión es robusta para manejar espacios en blanco y saltos de línea.
 * @param {string} csvText - La cadena de texto crudo del archivo.
 * @returns {Array<Object>} Un array de objetos con las propiedades definidas por la cabecera.
 */
function parsearCSV(csvText) {
    if (!csvText) return [];

    // Usar split(/\r?\n/) para manejar saltos de línea de Windows (\r\n) y Unix (\n).
    const lineas = csvText.trim().split(/\r?\n/);
    if (lineas.length <= 1) return [];

    // 1. Extraer y limpiar la cabecera
    const cabeceras = lineas[0].split(',').map(h => h.trim());
    
    const datos = [];
    
    // 2. Iterar sobre las filas de datos
    for (let i = 1; i < lineas.length; i++) {
        // Usar split(',') asumiendo que el formato no usa comas dentro de comillas.
        const valores = lineas[i].split(',');
        
        // Limpiar la línea y verificar la longitud.
        if (lineas[i].trim() === '' || valores.length !== cabeceras.length) continue;

        const objeto = {};
        for (let j = 0; j < cabeceras.length; j++) {
            // Asignar el valor de la columna, limpiando espacios en blanco.
            objeto[cabeceras[j]] = valores[j] ? valores[j].trim().replace(/^"(.*)"$/, '$1') : '';
        }
        datos.push(objeto);
    }
    return datos;
}

// ----------------------------------------------------------------------

/**
 * @function cargarDatosGTFS
 * @description Carga los datos GTFS haciendo fetch a los archivos de la carpeta 'gtfs/', 
 * los carga como texto plano (.txt) y luego los procesa (parsea CSV).
 */
async function cargarDatosGTFS() {
    try {
        const baseURL = 'gtfs/';
        const fileExtension = '.txt';

        // 1. CARGA DE DATOS (Texto Plano)
        // Se cargan todos los archivos especificados, aunque solo se usen 5
        const [routesTexto, tripsTexto, stopsTexto, stopTimesTexto, calendarTexto, shapesTexto, agencyTexto, feedInfoTexto, frequencesTexto] = await Promise.all([
            fetch(baseURL + 'routes' + fileExtension).then(r => r.text()), 
            fetch(baseURL + 'trips' + fileExtension).then(r => r.text()),
            fetch(baseURL + 'stops' + fileExtension).then(r => r.text()),
            fetch(baseURL + 'stop_times' + fileExtension).then(r => r.text()),
            fetch(baseURL + 'calendar' + fileExtension).then(r => r.text()),
            fetch(baseURL + 'shapes' + fileExtension).then(r => r.text()),
            fetch(baseURL + 'agency' + fileExtension).then(r => r.text()),
            fetch(baseURL + 'feed_info' + fileExtension).then(r => r.text()),
            fetch(baseURL + 'frequences' + fileExtension).then(r => r.text())
        ]);
        
        // 2. PROCESAMIENTO DE DATOS (Parseo CSV)
        const routes = parsearCSV(routesTexto);
        const trips = parsearCSV(tripsTexto);
        const stops = parsearCSV(stopsTexto);
        const stopTimes = parsearCSV(stopTimesTexto);
        const shapesArray = parsearCSV(shapesTexto); 

        console.log("✅ Datos cargados y procesados correctamente.");
        
        // 3. INICIAR MAPA
        iniciarMapa(stops, stopTimes, trips, routes, shapesArray);

    } catch (e) {
        console.error("❌ Error cargando GTFS:", e);
        alert("Error cargando datos. Asegúrate de que los archivos TXT estén en 'gtfs/' y contengan datos CSV/texto válido.");
    }
}

// ----------------------------------------------------------------------

function iniciarMapa(stops, stopTimes, trips, routes, shapesArray) {
    // Configuración del mapa
    const map = L.map('map').setView([39.9864, -0.0513], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Icono de la parada
    const busDivIcon = L.divIcon({
        html: `<div style="
      background: #0078A8; 
      border-radius: 50%; 
      width: 30px; 
      height: 30px; 
      display: flex; 
      justify-content: center; 
      align-items: center; 
      color: white; 
      font-weight: bold;
      font-size: 18px;
      ">
      🚌
      </div>`,
        className: '',
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -30]
    });

    // Añadimos estilos para parpadeo
    const style = document.createElement('style');
    style.innerHTML = `
    @keyframes parpadeo {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    .parpadeo {
      animation: parpadeo 1s infinite;
      font-weight: bold;
      color: red;
    }
  `;
    document.head.appendChild(style);

    const clusterGroup = L.markerClusterGroup();

    // 1. DIBUJAR PARADAS
    stops.forEach(stop => {
        // Asegurarse de que lat y lon son números (esto resuelve el problema de visibilidad)
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        
        // Si las coordenadas no son válidas, se omite el marcador.
        if (isNaN(lat) || isNaN(lon)) return; 
        
        const marker = L.marker([lat, lon], {
            icon: busDivIcon
        });
        marker.bindPopup("Cargando...");

        marker.on('click', () => {
            const horarios = stopTimes
                .filter(st => st.stop_id === stop.stop_id)
                .map(st => {
                    const trip = trips.find(t => t.trip_id === st.trip_id);
                    if (!trip) return null;

                    const ruta = routes.find(r => r.route_id === trip.route_id);
                    if (!ruta) return null;

                    return {
                        linea: ruta.route_short_name || '',
                        nombre: ruta.route_long_name || '',
                        hora: st.departure_time
                    };
                })
                .filter(h => h !== null)
                .sort((a, b) => a.hora.localeCompare(b.hora));

            const ahora = new Date();

            function horaAFecha(horaStr) {
                const [hh, mm, ss] = horaStr.split(':').map(Number);
                const fecha = new Date(ahora);
                fecha.setHours(hh, mm, ss, 0);
                return fecha;
            }

            const horariosConDiff = horarios.map(h => {
                const fechaSalida = horaAFecha(h.hora);
                let diffMin = (fechaSalida - ahora) / 60000;
                if (diffMin < 0) diffMin += 24 * 60;
                return {
                    ...h,
                    diffMin,
                    fechaSalida
                };
            });

            horariosConDiff.sort((a, b) => a.diffMin - b.diffMin);
            const futuros = horariosConDiff.filter(h => h.diffMin >= 0);

            if (futuros.length === 0) {
                marker.setPopupContent(`<strong>${stop.stop_name}</strong><br>No hay más servicios hoy.`);
                return;
            }

            const proximosMinutos = futuros.slice(0, 2);
            const siguientesHoras = futuros.slice(2, 5);

            let html = `<strong>${stop.stop_name}</strong><br><ul>`;

            proximosMinutos.forEach(h => {
                if (h.diffMin <= 1) {
                    html += `<li><b>${h.linea}</b> ${h.nombre}: <span class="parpadeo">en ${Math.round(h.diffMin)} min</span></li>`;
                } else {
                    html += `<li><b>${h.linea}</b> ${h.nombre}: en ${Math.round(h.diffMin)} min</li>`;
                }
            });

            siguientesHoras.forEach(h => {
                html += `<li><b>${h.linea}</b> ${h.nombre}: ${h.hora}</li>`;
            });

            html += '</ul>';

            marker.setPopupContent(html);
        });

        clusterGroup.addLayer(marker);
    });

    map.addLayer(clusterGroup);

    // 2. DIBUJAR SHAPES (Rutas)
    const shapesMap = shapesArray.reduce((acc, pt) => {
        acc[pt.shape_id] = acc[pt.shape_id] || [];
        acc[pt.shape_id].push(pt);
        return acc;
    }, {});
    
    for (const shapeId in shapesMap) {
        const puntos = shapesMap[shapeId];

        puntos.sort((a, b) => parseInt(a.shape_pt_sequence) - parseInt(b.shape_pt_sequence));

        const latlngs = puntos.map(pt => [
            parseFloat(pt.shape_pt_lat),
            parseFloat(pt.shape_pt_lon)
        ]);

        // Evitar dibujar si hay coordenadas inválidas
        if (latlngs.every(([lat, lon]) => !isNaN(lat) && !isNaN(lon))) {
             L.polyline(latlngs, {
                color: 'blue',
                weight: 3,
                opacity: 0.7
            }).addTo(map);
        }
    }
}

cargarDatosGTFS();