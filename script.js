/**
 * @function cargarDatosGTFS
 * @description Carga los datos GTFS haciendo fetch a los archivos de la carpeta 'gtfs/'. 
 * Los archivos se cargan como cadenas de texto plano (usando .text()).
 *
 * ⚠️ ADVERTENCIA: La función iniciarMapa NO funcionará con estas cadenas de texto
 * hasta que se le añada un parser CSV/Texto.
 */
async function cargarDatosGTFS() {
    try {
        const baseURL = 'gtfs/';
        const fileExtension = '.txt'; // Archivos en formato de texto plano

        // 🚨 CAMBIO CRÍTICO: Usamos .text() en lugar de .json(). Las variables ahora son cadenas de texto.
        const [routesTexto, tripsTexto, stopsTexto, stopTimesTexto, calendarDatesTexto, shapesTexto] = await Promise.all([
            fetch(baseURL + 'routes' + fileExtension).then(r => r.text()), 
            fetch(baseURL + 'trips' + fileExtension).then(r => r.text()),
            fetch(baseURL + 'stops' + fileExtension).then(r => r.text()),
            fetch(baseURL + 'stop_times' + fileExtension).then(r => r.text()),
            fetch(baseURL + 'calendar_dates' + fileExtension).then(r => r.text()),
            fetch(baseURL + 'shapes' + fileExtension).then(r => r.text())
        ]);

        console.log("✅ Datos cargados como texto plano.");
        
        // El llamado a iniciarMapa con las cadenas de texto (fallará con la lógica original)
        iniciarMapa(stopsTexto, stopTimesTexto, tripsTexto, routesTexto, shapesTexto);

    } catch (e) {
        console.error("❌ Error cargando GTFS:", e);
        alert("Error cargando datos. Asegúrate de que los archivos TXT estén en 'gtfs/'. Mira la consola.");
    }
}

// ----------------------------------------------------------------------
// ⚠️ ATENCIÓN: Esta función DEBE ser modificada para procesar cadenas de texto.
// EL CÓDIGO A CONTINUACIÓN FALLARÁ con la Opción B porque las variables de entrada 
// (stops, stopTimes, etc.) no son arrays, sino cadenas de texto.
// ----------------------------------------------------------------------

function iniciarMapa(stops, stopTimes, trips, routes, shapes) {
    const map = L.map('map').setView([39.9864, -0.0513], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

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

    // ❌ ESTO FALLARÁ: 'stops' es ahora una cadena de texto, no un array que se pueda iterar con forEach.
    stops.forEach(stop => {
        const marker = L.marker([stop.stop_lat, stop.stop_lon], {
            icon: busDivIcon
        });
        marker.bindPopup("Cargando...");

        marker.on('click', () => {
            const horarios = stopTimes
                .filter(st => st.stop_id === stop.stop_id)
                // ... el resto de la lógica de GTFS fallará aquí ...
                
                // ... el resto del código ...
        });

        clusterGroup.addLayer(marker);
    });

    map.addLayer(clusterGroup);

    // Dibujar shapes
    for (const shapeId in shapes) {
        // ... esto también fallará ...
    }
}

cargarDatosGTFS();