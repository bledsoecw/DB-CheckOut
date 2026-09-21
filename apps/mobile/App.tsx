import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initAutoFlush } from "./src/api";
import { AuthProvider, useAuth } from "./src/auth";
import { LangProvider, useLang } from "./src/i18n";
import { colors } from "./src/theme";
import SignInScreen from "./src/screens/SignInScreen";
import QueueScreen from "./src/screens/QueueScreen";
import JobScreen from "./src/screens/JobScreen";
import ChecklistScreen from "./src/screens/ChecklistScreen";
import CleanupScreen from "./src/screens/CleanupScreen";
import ReportScreen from "./src/screens/ReportScreen";
import SendScreen from "./src/screens/SendScreen";
import PunchListScreen from "./src/screens/PunchListScreen";
import PunchItemScreen from "./src/screens/PunchItemScreen";
import OutboxScreen from "./src/screens/OutboxScreen";

initAutoFlush();

export type RootStackParamList = {
  Queue: undefined;
  Job: { jobId: string };
  Checklist: { jobId: string };
  Cleanup: { jobId: string };
  /** `from` pre-fills "Where is it?" with the checklist line that failed; `itemKey` is that line. */
  Report: { jobId: string; from?: string; itemKey?: string };
  Send: { jobId: string };
  PunchList: { jobId: string };
  PunchItem: { jobId: string; taskId: string };
  Outbox: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Sample data, nothing sent: say so on every screen, the whole time. */
function DemoBanner() {
  const { p } = useLang();
  const { signOut } = useAuth();
  return (
    <Pressable onPress={signOut} style={styles.demoBanner}>
      <Text style={styles.demoBannerText}>
        {p({
          es: "DEMOSTRACIÓN · datos de ejemplo — nada se envía a JobTread · toca para salir",
          en: "DEMO · sample data — nothing is sent to JobTread · tap to leave",
        })}
      </Text>
    </Pressable>
  );
}

function Root() {
  const { ready, mode } = useAuth();
  if (!ready) return null;
  if (mode === null) return <SignInScreen />;
  return (
    <View style={{ flex: 1 }}>
      {mode === "demo" ? <DemoBanner /> : null}
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="Queue" component={QueueScreen} />
          <Stack.Screen name="Job" component={JobScreen} />
          <Stack.Screen name="Checklist" component={ChecklistScreen} />
          <Stack.Screen name="Cleanup" component={CleanupScreen} />
          <Stack.Screen name="Report" component={ReportScreen} />
          <Stack.Screen name="Send" component={SendScreen} />
          <Stack.Screen name="PunchList" component={PunchListScreen} />
          <Stack.Screen name="PunchItem" component={PunchItemScreen} />
          <Stack.Screen name="Outbox" component={OutboxScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  demoBanner: { backgroundColor: "#7A1F1F", paddingVertical: 8, paddingHorizontal: 12, paddingTop: 14 },
  demoBannerText: { color: "#fff", fontSize: 12.5, fontWeight: "700", textAlign: "center" },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <LangProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <Root />
        </AuthProvider>
      </LangProvider>
    </SafeAreaProvider>
  );
}
