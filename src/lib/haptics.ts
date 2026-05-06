/** Light tap — checkbox toggle, button press */
export function hapticTap() {
  // 8ms is too short for most Android vibration motors to spin up. Increased to 25ms.
  try { navigator?.vibrate?.(25); } catch { /* unsupported */ }
}

/** Medium — tab switch, successful action */
export function hapticMedium() {
  // Increased to 40ms to be noticeably stronger
  try { navigator?.vibrate?.(40); } catch { /* unsupported */ }
}

/** Success pattern — drag-drop complete, pull-to-refresh done */
export function hapticSuccess() {
  // A distinct double-tap pattern
  try { navigator?.vibrate?.([30, 50, 40]); } catch { /* unsupported */ }
}
