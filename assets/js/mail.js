// ============================================================
// CORREOS AUTOMÁTICOS — EmailJS (cuenta gratuita, 200 al mes)
// Las plantillas se editan en emailjs.com; aquí solo van sus códigos.
// ============================================================
import emailjs from 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/+esm';

const SERVICE   = 'service_w76xi5m';
const TEMPLATES = {
    approval: 'template_n6t2bx8',   // alumno aprobado: to_name, to_email, course_name, student_code
    welcome:  'template_eyzhy86',   // recién registrado: to_name, to_email, wa_link
};
emailjs.init('_S-T8AGnU-LZveZ7y');

// Envía la plantilla indicada. Lanza si EmailJS falla: quien llama decide qué hacer.
export const sendMail = (template, params) => emailjs.send(SERVICE, TEMPLATES[template], params);
