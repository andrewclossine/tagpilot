/**
 * The Terms of Service and the Privacy Policy, in English and French. They describe how TAGPILOT works today
 * (hosting, backups, payments, email, cookies). Have them reviewed by a lawyer before relying on them.
 */
export const LEGAL_UPDATED = "2026-11-12";

type Doc = { title: string; intro: string; sections: [string, string][] };

const terms: Record<"en" | "fr", Doc> = {
  en: {
    title: "Terms of Service",
    intro: "These terms apply to every organisation and person that uses TAGPILOT (the accounting, project management and procurement apps, the supplier portal and the apps for computers and phones). By creating an account or using TAGPILOT you accept them.",
    sections: [
      ["1. The service", "TAGPILOT is online software. Each organisation (the \"customer\") gets its own space with the apps it chooses. Its administrators invite users, give them roles and decide what each one can see and do."],
      ["2. Accounts", "Keep your sign-in details private and tell us at once if you think someone else used them. Each person uses their own account. The customer is responsible for what its users do in its space."],
      ["3. Trial and subscription", "A new organisation has a free trial of 30 days. To keep changing its records afterwards, an administrator pays the subscription for the apps chosen, monthly or yearly, at the prices shown on the pricing page. Without payment the records stay readable. Prices can change; a change applies from the next period, after notice."],
      ["4. Your data", "The records you put in TAGPILOT belong to you. We use them only to provide the service, as described in the Privacy Policy. You can export your reports and documents at any time. After an account is closed, we keep the data for a limited time and then delete it, except where the law requires us to keep it."],
      ["5. Acceptable use", "Do not use TAGPILOT for anything unlawful, to send unwanted messages, to try to reach other organisations' data, to overload or harm the service, or to copy the software. We may suspend an account that breaks these rules, and we tell its administrator why."],
      ["6. Your responsibility for the books", "TAGPILOT helps you keep your books, run projects and procurement, and prepare reports and tax figures. You remain responsible for your records, your filings and your decisions, and for checking them with a qualified accountant where needed. Suggestions made by the AI features must be checked before they are used."],
      ["7. Availability and backups", "We work to keep TAGPILOT available and back up the data every day, with a copy kept off the server. Maintenance or events outside our control can interrupt the service; we try to announce planned interruptions."],
      ["8. Liability", "TAGPILOT is provided with reasonable care. As far as the law allows, we are not liable for indirect losses or lost profits, and our total liability is limited to what the customer paid for the twelve months before the event."],
      ["9. Changes and ending", "We may change these terms; we publish the new version here with its date and tell administrators of important changes. A customer can stop using TAGPILOT at any time. We can end the service to a customer that does not pay or breaks these terms, after notice."],
      ["10. Law", "These terms are governed by the laws of the Republic of Rwanda. A dispute that cannot be settled amicably goes to the competent courts of Rwanda."],
    ],
  },
  fr: {
    title: "Conditions d'utilisation",
    intro: "Ces conditions s'appliquent à toute organisation et personne qui utilise TAGPILOT (les applications de comptabilité, de gestion de projets et d'achats, le portail fournisseurs et les applications pour ordinateur et téléphone). En créant un compte ou en utilisant TAGPILOT, vous les acceptez.",
    sections: [
      ["1. Le service", "TAGPILOT est un logiciel en ligne. Chaque organisation (le « client ») dispose de son propre espace avec les applications qu'elle choisit. Ses administrateurs invitent les utilisateurs, leur donnent des rôles et décident de ce que chacun peut voir et faire."],
      ["2. Comptes", "Gardez vos identifiants confidentiels et prévenez-nous immédiatement si vous pensez qu'un tiers les a utilisés. Chaque personne utilise son propre compte. Le client est responsable de ce que ses utilisateurs font dans son espace."],
      ["3. Essai et abonnement", "Une nouvelle organisation bénéficie d'un essai gratuit de 30 jours. Pour continuer à modifier ses données ensuite, un administrateur paie l'abonnement des applications choisies, au mois ou à l'année, aux prix indiqués sur la page des tarifs. Sans paiement, les données restent consultables. Les prix peuvent changer ; un changement s'applique à la période suivante, après préavis."],
      ["4. Vos données", "Les données que vous saisissez dans TAGPILOT vous appartiennent. Nous les utilisons uniquement pour fournir le service, comme décrit dans la Politique de confidentialité. Vous pouvez exporter vos états et documents à tout moment. Après la fermeture d'un compte, nous conservons les données un temps limité puis les supprimons, sauf obligation légale de conservation."],
      ["5. Usage acceptable", "N'utilisez pas TAGPILOT pour une activité illégale, pour envoyer des messages non sollicités, pour tenter d'accéder aux données d'autres organisations, pour surcharger ou endommager le service, ni pour copier le logiciel. Nous pouvons suspendre un compte qui enfreint ces règles et en informons son administrateur."],
      ["6. Votre responsabilité comptable", "TAGPILOT vous aide à tenir votre comptabilité, à gérer projets et achats, et à préparer états et chiffres fiscaux. Vous restez responsable de vos écritures, de vos déclarations et de vos décisions, et de les faire vérifier par un comptable qualifié si nécessaire. Les suggestions des fonctions d'IA doivent être vérifiées avant usage."],
      ["7. Disponibilité et sauvegardes", "Nous veillons à la disponibilité de TAGPILOT et sauvegardons les données chaque jour, avec une copie conservée hors du serveur. Une maintenance ou un événement indépendant de notre volonté peut interrompre le service ; nous annonçons autant que possible les interruptions prévues."],
      ["8. Responsabilité", "TAGPILOT est fourni avec un soin raisonnable. Dans les limites permises par la loi, nous ne sommes pas responsables des pertes indirectes ou du manque à gagner, et notre responsabilité totale est limitée à ce que le client a payé au cours des douze mois précédant l'événement."],
      ["9. Modifications et fin", "Nous pouvons modifier ces conditions ; la nouvelle version est publiée ici avec sa date et les administrateurs sont informés des changements importants. Un client peut cesser d'utiliser TAGPILOT à tout moment. Nous pouvons mettre fin au service d'un client qui ne paie pas ou enfreint ces conditions, après préavis."],
      ["10. Droit applicable", "Ces conditions sont régies par les lois de la République du Rwanda. Un litige qui ne peut être réglé à l'amiable relève des juridictions compétentes du Rwanda."],
    ],
  },
};

const privacy: Record<"en" | "fr", Doc> = {
  en: {
    title: "Privacy Policy",
    intro: "This policy explains what personal data TAGPILOT handles, why, and your rights. It follows Rwanda's Law No 058/2021 on the protection of personal data and privacy.",
    sections: [
      ["1. Who is responsible", "Each organisation using TAGPILOT is responsible for the personal data it puts in its space (its staff, customers, suppliers, beneficiaries). TAGPILOT processes that data on its behalf to provide the service. For the accounts of users themselves, TAGPILOT is responsible."],
      ["2. What we handle", "Account data: name, username, email, a protected form of the password, sign-in times and the address used. Organisation data: the records you enter, such as invoices, bills, payroll, projects, tenders and bids, and the files you attach. Payment data: what is needed to record a subscription; card and mobile money details are handled by the payment provider, not stored by TAGPILOT."],
      ["3. Why", "To provide and secure the service, keep your records, send the emails you ask for (invoices, statements, reminders, notifications), handle subscriptions, answer support requests and meet legal obligations. We do not sell personal data and do not use it for advertising."],
      ["4. Who else sees it", "Only the people your organisation gives access to, and TAGPILOT staff where needed to run or support the service. We use service providers for hosting, email delivery, payments and the AI features that read documents you choose to scan; they receive only what they need for that task."],
      ["5. Where it is kept and for how long", "On servers we rent, with a backup every day and a copy kept off the server. Records are kept while the organisation uses TAGPILOT and for a limited time after, unless the law requires longer, such as accounting records."],
      ["6. Security", "Access by role, encrypted connections, protected passwords, locking after repeated failed sign-ins, sealed bids until their opening, and an audit trail of changes."],
      ["7. Cookies", "TAGPILOT uses only the cookies it needs: one to keep you signed in, one to remember your language, and the browser's own storage for small preferences. No advertising or tracking cookies."],
      ["8. Your rights", "You can ask to see, correct or delete your personal data, or object to its use, as the law provides. For data in an organisation's space, contact that organisation first; we help it answer. You can also complain to Rwanda's supervisory authority for personal data protection."],
      ["9. Changes", "We publish any new version of this policy here with its date, and tell administrators of important changes."],
    ],
  },
  fr: {
    title: "Politique de confidentialité",
    intro: "Cette politique explique quelles données personnelles TAGPILOT traite, pourquoi, et quels sont vos droits. Elle suit la loi rwandaise n° 058/2021 relative à la protection des données à caractère personnel et de la vie privée.",
    sections: [
      ["1. Responsable", "Chaque organisation qui utilise TAGPILOT est responsable des données personnelles qu'elle met dans son espace (personnel, clients, fournisseurs, bénéficiaires). TAGPILOT les traite pour son compte afin de fournir le service. Pour les comptes des utilisateurs eux-mêmes, TAGPILOT est responsable."],
      ["2. Données traitées", "Données de compte : nom, nom d'utilisateur, e-mail, forme protégée du mot de passe, heures de connexion et adresse utilisée. Données de l'organisation : les données saisies, comme factures, factures fournisseurs, paie, projets, appels d'offres et offres, et les fichiers joints. Données de paiement : ce qui est nécessaire pour enregistrer un abonnement ; les données de carte et de mobile money sont traitées par le prestataire de paiement, pas conservées par TAGPILOT."],
      ["3. Finalités", "Fournir et sécuriser le service, conserver vos données, envoyer les e-mails que vous demandez (factures, relevés, relances, notifications), gérer les abonnements, répondre au support et respecter les obligations légales. Nous ne vendons pas de données personnelles et ne les utilisons pas pour la publicité."],
      ["4. Destinataires", "Seules les personnes à qui votre organisation donne accès, et le personnel de TAGPILOT lorsque c'est nécessaire au fonctionnement ou au support. Nous faisons appel à des prestataires pour l'hébergement, l'envoi d'e-mails, les paiements et les fonctions d'IA qui lisent les documents que vous choisissez de scanner ; ils ne reçoivent que ce qui est nécessaire."],
      ["5. Lieu et durée de conservation", "Sur des serveurs que nous louons, avec une sauvegarde chaque jour et une copie conservée hors du serveur. Les données sont conservées tant que l'organisation utilise TAGPILOT et un temps limité ensuite, sauf si la loi impose plus longtemps, comme pour les documents comptables."],
      ["6. Sécurité", "Accès par rôle, connexions chiffrées, mots de passe protégés, blocage après des échecs de connexion répétés, offres scellées jusqu'à leur ouverture, et piste d'audit des modifications."],
      ["7. Cookies", "TAGPILOT n'utilise que les cookies nécessaires : un pour garder votre session, un pour retenir votre langue, et le stockage du navigateur pour de petites préférences. Aucun cookie publicitaire ou de suivi."],
      ["8. Vos droits", "Vous pouvez demander l'accès, la rectification ou la suppression de vos données personnelles, ou vous opposer à leur utilisation, selon la loi. Pour les données d'un espace d'organisation, contactez d'abord cette organisation ; nous l'aidons à répondre. Vous pouvez aussi saisir l'autorité rwandaise de contrôle de la protection des données."],
      ["9. Modifications", "Toute nouvelle version de cette politique est publiée ici avec sa date, et les administrateurs sont informés des changements importants."],
    ],
  },
};

export const LEGAL = { terms, privacy };
