// The curated toolbar-button icons offered by the launcher (Material icon
// names the host renders), and the icons the launcher itself uses. The build
// inlines each icon's SVG from @material-design-icons/svg, so the pages need
// no icon font and work offline. Every name must also exist in the hosts'
// toolbar icon font: Freeboard-SK bundles an older Material Icons font, which
// lacks newer names such as gas_meter and solar_power. `web` is left out: it is
// the main Companion Apps button's icon, and two identical buttons would be
// ambiguous on the toolbar.

export const BUTTON_ICONS = [
  ['speed', 'Speed'],
  ['dashboard', 'Dashboard'],
  ['waves', 'Waves'],
  ['sailing', 'Sailing'],
  ['directions_boat', 'Boat'],
  ['anchor', 'Anchor'],
  ['explore', 'Compass'],
  ['map', 'Map'],
  ['radar', 'Radar'],
  ['satellite_alt', 'Satellite'],
  ['air', 'Wind'],
  ['cloud', 'Weather'],
  ['thermostat', 'Temperature'],
  ['water_drop', 'Water'],
  ['local_gas_station', 'Fuel'],
  ['battery_charging_full', 'Battery'],
  ['bolt', 'Power'],
  ['wb_sunny', 'Solar'],
  ['videocam', 'Camera'],
  ['sensors', 'Sensors'],
  ['tune', 'Controls'],
  ['apps', 'Apps']
]

// Icons no longer offered in the picker. Still bundled and named, so an entry
// saved with one keeps drawing it. `web` became the main button's icon.
export const RETIRED_ICONS = [['web', 'Web page']]

export const UI_ICONS = ['info', 'add', 'arrow_back', 'arrow_drop_down', 'block', 'chevron_left', 'chevron_right', 'settings', 'web_asset', 'web_asset_off']
