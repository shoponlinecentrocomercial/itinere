document.getElementById('btn-selfie').addEventListener('click', async () => {
    try {
        // 1. Solicitar acceso a la cámara frontal ("user")
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" } 
        });

        const video = document.getElementById('video');
        video.srcObject = stream;

        // 2. Esperar a que el video empiece a reproducirse
        video.onloadedmetadata = () => {
            video.play();
            
            // Damos 1 segundo de margen para que la cámara ajuste luz y enfoque
            setTimeout(() => {
                capturarYEnviar(stream);
            }, 1000); 
        };

    } catch (error) {
        console.error('Error al acceder a la cámara:', error);
        alert('No se pudo acceder a la cámara. Revisa los permisos.');
    }
});

function capturarYEnviar(stream) {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    // 3. Calcular el recorte para tomar el centro del video (un cuadrado perfecto)
    const size = Math.min(video.videoWidth, video.videoHeight);
    const startX = (video.videoWidth - size) / 2;
    const startY = (video.videoHeight - size) / 2;

    // 4. Preparar el Canvas para que el recorte sea Redondo
    ctx.clearRect(0, 0, 50, 50);
    ctx.save();
    ctx.beginPath();
    ctx.arc(25, 25, 25, 0, Math.PI * 2, true); // Círculo de radio 25px centrado
    ctx.closePath();
    ctx.clip(); // Aplicar la máscara circular

    // 5. Dibujar el video dentro del círculo, escalado a 50x50
    ctx.drawImage(video, startX, startY, size, size, 0, 0, 50, 50);
    ctx.restore();

    // 6. Apagar la cámara (detener los tracks)
    stream.getTracks().forEach(track => track.stop());

    // 7. Convertir el Canvas a Blob (PNG para que las esquinas sean transparentes) y enviar
    canvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append('selfie', blob, 'selfie.png'); // 'selfie' es el nombre del campo que recibe tu backend

        try {
            // Cambia esta URL por la de tu endpoint real
            const response = await fetch('https://itinere.pro/usuario.php', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                console.log('Selfie de 50px enviado con éxito');
                // Opcional: Puedes mostrar el resultado en la imagen original
                 document.getElementById('btn-selfie').src = URL.createObjectURL(blob);
            } else {
                console.error('El servidor respondió con error');
            }
        } catch (error) {
            console.error('Error enviando la foto por fetch:', error);
        }
    }, 'image/png'); // Importante usar PNG, si usas JPEG el fondo transparente se verá negro
}