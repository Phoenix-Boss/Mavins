/**
 * MessageModal - FIREBASE REMOVED
 *
 * Previously fetched an active message from Firestore and displayed it as a modal.
 * Firebase has been removed from the project until the website is live, at which
 * point a single Firebase project will control push notifications and messaging
 * for both the web app and this Android app.
 *
 * TO RE-ENABLE:
 *   1. Restore @react-native-firebase/app + @react-native-firebase/firestore
 *   2. Restore the firebase plugin in app.config.js
 *   3. Replace the firestore() calls below with the modular v9+ API:
 *        import { getFirestore, doc, getDoc } from '@react-native-firebase/firestore'
 *        const db = getFirestore()
 *        const snap = await getDoc(doc(db, 'appData', 'activeMessage'))
 *
 * For now this component renders nothing so call sites do not need to be touched.
 */

export const MessageModal = () => null;