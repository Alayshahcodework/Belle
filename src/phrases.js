// Everything the bedside screen says out loud or shows on screen, in the two
// languages the roster uses. Spoken and visible wording are kept together so
// they never drift apart -- a sighted patient and a blind patient should be
// getting the same information.

export const PHRASES = {
  en: {
    // spoken
    prompt: 'Record your request.',
    retry: 'Sorry, I did not understand. Record your request again.',
    confirm: (department) => `Your request is sent to ${department}. Someone is on the way.`,
    urgent: 'This sounds urgent. I am alerting your nurse now.',
    // Spoken when the patient's chart diverts a food or drink request to the
    // nurse. Kind and plain: the patient should understand, not be alarmed.
    override: {
      npo: 'Your nurse needs to check this first, because you are not cleared to eat or drink right now. I have asked them to come and see you.',
      dysphagia:
        'Your drinks need to be prepared a special way, so your nurse will bring this to you.',
      fluid:
        'Your fluids are being measured today, so your nurse will bring this to you.',
    },
    overrideShort: {
      npo: 'Your nurse will check this first',
      dysphagia: 'Your nurse will prepare this',
      fluid: 'Your nurse will bring this',
    },
    handoff:
      'Sorry, I could not understand. I have passed your message to your nurse, who will come to you.',
    gaveUp:
      'Sorry, I could not hear you. Touch anywhere on the screen to try again, or press the red button for your nurse.',

    // on screen
    recordTitle: 'Record your request',
    listening: 'Listening…',
    thinking: 'One moment…',
    retryTitle: 'Sorry — please say that again',
    sentTitle: 'Sent',
    handoffTitle: 'Passed to your nurse',
    gaveUpTitle: 'I could not hear you',
    touchToStart: 'Touch anywhere to start',
    tapToTalk: 'Tap to talk',
    attempt: (n, of) => `Try ${n} of ${of}`,
    orTap: 'Or tap one of these',
    typePlaceholder: 'Type what you need…',
    send: 'Send',
    goesTo: 'Goes to',
    urgentPreview: 'Urgent — goes straight to',
    onTheWay: 'On the way',
    room: 'Room',
  },

  es: {
    prompt: 'Grabe su solicitud.',
    retry: 'Disculpe, no entendí. Grabe su solicitud otra vez.',
    confirm: (department) => `Su solicitud fue enviada a ${department}. Alguien viene en camino.`,
    urgent: 'Esto parece urgente. Estoy avisando a su enfermera ahora.',
    override: {
      npo: 'Su enfermera debe revisar esto primero, porque ahora no puede comer ni beber. Le he pedido que venga a verle.',
      dysphagia:
        'Sus bebidas deben prepararse de manera especial, así que su enfermera se las traerá.',
      fluid:
        'Hoy se están midiendo sus líquidos, así que su enfermera se los traerá.',
    },
    overrideShort: {
      npo: 'Su enfermera lo revisará primero',
      dysphagia: 'Su enfermera lo preparará',
      fluid: 'Su enfermera se lo traerá',
    },
    handoff:
      'Disculpe, no entendí. Le pasé su mensaje a su enfermera, que vendrá a verle.',
    gaveUp:
      'Disculpe, no pude escucharle. Toque la pantalla para intentar otra vez, o presione el botón rojo para llamar a su enfermera.',

    recordTitle: 'Grabe su solicitud',
    listening: 'Escuchando…',
    thinking: 'Un momento…',
    retryTitle: 'Disculpe — repítalo por favor',
    sentTitle: 'Enviado',
    handoffTitle: 'Enviado a su enfermera',
    gaveUpTitle: 'No pude escucharle',
    touchToStart: 'Toque la pantalla para empezar',
    tapToTalk: 'Toque para hablar',
    attempt: (n, of) => `Intento ${n} de ${of}`,
    orTap: 'O toque una de estas',
    typePlaceholder: 'Escriba lo que necesita…',
    send: 'Enviar',
    goesTo: 'Va a',
    urgentPreview: 'Urgente — va directamente a',
    onTheWay: 'En camino',
    room: 'Habitación',
  },
};

export const QUICK_LABELS = {
  en: {
    water: 'Water or ice',
    snack: 'Something to eat',
    linens: 'Blanket or pillow',
    bathroom: 'Help to bathroom',
    tv: 'TV, phone or lights',
    clean: 'Room needs cleaning',
  },
  es: {
    water: 'Agua o hielo',
    snack: 'Algo de comer',
    linens: 'Manta o almohada',
    bathroom: 'Ayuda al baño',
    tv: 'TV, teléfono o luces',
    clean: 'Limpieza de la habitación',
  },
};

export const langKey = (language) => (language === 'Spanish' ? 'es' : 'en');
