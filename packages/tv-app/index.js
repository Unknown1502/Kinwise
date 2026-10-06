/*
 * Kinwise for Fire TV (Vega OS) entry point.
 * Project layout mirrors AmazonAppDev/react-native-multi-tv-app-sample apps/vega (MIT-0).
 */

import {AppRegistry, LogBox} from 'react-native';
// Resolves to src/remote.vega.ts on Vega: maps the Fire TV remote (D-pad, Select, Back)
// onto react-tv-space-navigation before the first SpatialNavigationRoot mounts.
import './src/remote';
import {App} from './src/App';
import {name as appName} from './app.json';

// Same workaround as Amazon's Vega sample (nested <Text> warnings on Vega).
LogBox.ignoreAllLogs();

AppRegistry.registerComponent(appName, () => App);
