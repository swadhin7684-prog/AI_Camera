import React, { useState, useEffect, useRef } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { AppHeader } from './components/AppHeader';
import { DashboardView } from './components/views/DashboardView';
import { LiveMonitorView } from './components/views/LiveMonitorView';
import { VideoAnalysisView } from './components/views/VideoAnalysisView';
import { WorkersView } from './components/views/WorkersView';
import { RegisterWorkerView } from './components/views/RegisterWorkerView';
import { ScanQRView } from './components/views/ScanQRView';
import { CamerasView } from './components/views/CamerasView';
import { AlertsView } from './components/views/AlertsView';
import { IncidentsView } from './components/views/IncidentsView';
import { AnalyticsView } from './components/views/AnalyticsView';
import { SettingsView } from './components/views/SettingsView';
import { WorkerProfileModal } from './components/modals/WorkerProfileModal';
import { IncidentDetailModal } from './components/modals/IncidentDetailModal';
import { SuperAdminPortal } from './components/admin/SuperAdminPortal';
import { LicenseActivationModal } from './components/modals/LicenseActivationModal';
import { CompanyUserLoginModal } from './components/auth/CompanyUserLoginModal';
import { adminApi, LicenseStatusResult } from './services/adminApi';
import { firebaseAuthService } from './services/firebase';

import {
  api,
  WorkerItem,
  CameraItem,
  IncidentItem,
  AlertItem,
  AnalyticsData,
  TelemetryPayload
} from './services/api';
import { soundService } from './services/sound';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');

  // Application Data States
  const [workers, setWorkers] = useState<WorkerItem[]>([]);
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [availableHardware, setAvailableHardware] = useState<{ index: string; name: string; resolution: string }[]>([]);
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null);

  // Selected Modal States
  const [selectedWorker, setSelectedWorker] = useState<WorkerItem | null>(null);
  const [editWorkerMode, setEditWorkerMode] = useState<boolean>(false);
  const [selectedIncident, setSelectedIncident] = useState<IncidentItem | null>(null);

  // Check if running in dedicated Super Admin Application mode
  const urlParams = new URLSearchParams(window.location.search);
  const isAdminApp = urlParams.get('app') === 'admin' || urlParams.get('mode') === 'admin' || window.location.hash.includes('admin');

  // Firebase User Authentication State
  const [currentUser, setCurrentUser] = useState<any>(firebaseAuthService.getCurrentUser());
  const [authInitialized, setAuthInitialized] = useState<boolean>(false);

  // Super Admin & Licensing States
  const [showSuperAdmin, setShowSuperAdmin] = useState<boolean>(false);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatusResult | null>(null);
  const [showLicenseModal, setShowLicenseModal] = useState<boolean>(false);

  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null);

  const checkLicense = async () => {
    try {
      const res = await adminApi.checkLicenseStatus();
      setLicenseStatus(res);
      if (!res.is_licensed) {
        setShowLicenseModal(true);
      } else {
        setShowLicenseModal(false);
      }
    } catch (e) {
      console.warn('License check error:', e);
    }
  };

  const loadData = async () => {
    checkLicense();
    try {
      const [wRes, cRes, hwRes, incRes, alRes, anRes] = await Promise.all([
        api.getWorkers(),
        api.getCameras(),
        api.getAvailableHardware(),
        api.getIncidents({ limit: 100 }),
        api.getAlerts(),
        api.getAnalytics()
      ]);

      if (wRes?.workers) setWorkers(wRes.workers);
      if (cRes?.cameras) setCameras(cRes.cameras);
      if (hwRes?.available) setAvailableHardware(hwRes.available);
      if (incRes?.incidents) setIncidents(incRes.incidents);
      if (alRes?.alerts) setAlerts(alRes.alerts);
      if (anRes?.analytics) setAnalytics(anRes.analytics);
    } catch (e) {
      console.warn('Initial load error:', e);
    }
  };

  useEffect(() => {
    const unsubscribe = firebaseAuthService.onStateChange((user) => {
      setCurrentUser(user);
      setAuthInitialized(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAdminApp) return; // Do not connect to video telemetry or camera streams in Admin mode

    loadData();

    // Setup real-time WebSocket connection
    const connectWS = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Telemetry WebSocket connected.');
      };

      ws.onmessage = (event) => {
        try {
          const data: TelemetryPayload = JSON.parse(event.data);
          setTelemetry(data);

          // If camera is stopped or inactive, immediately silence the alarm!
          if (!data.is_active) {
            soundService.stopAlarm();
            return;
          }

          // Check if any tracked worker has an active safety violation (Missing Helmet / Vest)
          const hasViolation = (data.tracked_people || []).some((person) => {
            if (!person.is_violation) return false;
            const hasHelmet = person.violations?.some((v: string) => /helmet/i.test(v));
            const hasVest = person.violations?.some((v: string) => /vest/i.test(v));
            return hasHelmet || hasVest || (person.violations && person.violations.length > 0);
          });

          // Continuously manage alarm with anti-flicker protection
          soundService.notifyViolation(hasViolation);
        } catch (e) {
          console.debug('WS parse error:', e);
        }
      };

      ws.onclose = () => {
        soundService.stopAlarm();
        console.log('WS disconnected. Reconnecting in 2s...');
        setTimeout(connectWS, 2000);
      };

      ws.onerror = () => {
        soundService.stopAlarm();
        ws.close();
      };
    };

    connectWS();

    // Periodic poll for background analytics & incidents (every 5 seconds)
    const pollInterval = setInterval(() => {
      api.getAnalytics().then((res) => {
        if (res?.analytics) setAnalytics(res.analytics);
      }).catch(() => {});

      api.getAlerts().then((res) => {
        if (res?.alerts) setAlerts(res.alerts);
      }).catch(() => {});

      api.getIncidents({ limit: 50 }).then((res) => {
        if (res?.incidents) setIncidents(res.incidents);
      }).catch(() => {});
    }, 5000);

    return () => {
      clearInterval(pollInterval);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const handleStartCamera = async (params: {
    camera_id: string;
    source: string;
    source_type: string;
    conf_thresh: number;
    model_choice: string;
  }) => {
    try {
      const res = await api.startCamera(params);
      setTelemetry((prev) => ({
        camera_id: params.camera_id,
        camera_name: 'Live Surveillance',
        zone: 'Welding Area',
        is_active: true,
        timestamp: new Date().toISOString(),
        model_choice: params.model_choice,
        supported_classes: res?.supported_classes || [],
        tracked_people: [],
        people_count: 0,
        violation_count: 0
      }));
    } catch (e) {
      console.error('Failed to start camera:', e);
    }
    await loadData();
  };

  const handleStopCamera = async () => {
    soundService.stopAlarm();
    try {
      await api.stopCamera();
    } catch (e) {
      console.error('Failed to stop camera:', e);
    }
    soundService.stopAlarm();
    setTelemetry((prev) => prev ? {
      ...prev,
      is_active: false,
      people_count: 0,
      tracked_people: [],
      violation_count: 0
    } : null);
    await loadData();
  };

  const handleAlertStatusChange = async (alertId: number, status: string) => {
    await api.updateAlertStatus(alertId, status);
    const updated = await api.getAlerts();
    if (updated?.alerts) setAlerts(updated.alerts);
  };

  const handleDeleteAlert = async (alertId: number) => {
    try {
      await api.deleteAlert(alertId);
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearAllAlerts = async () => {
    try {
      await api.clearAllAlerts();
      setAlerts([]);
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteIncident = async (incidentId: number) => {
    try {
      await api.deleteIncident(incidentId);
      setIncidents((prev) => prev.filter((i) => i.id !== incidentId));
      setAlerts((prev) => prev.filter((a) => a.incident_id !== incidentId));
      if (selectedIncident?.id === incidentId) {
        setSelectedIncident(null);
      }
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearAllIncidents = async () => {
    try {
      await api.clearAllIncidents();
      setIncidents([]);
      setAlerts([]);
      setSelectedIncident(null);
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleViewIncidentById = async (incidentId: number) => {
    const inc = incidents.find((i) => i.id === incidentId);
    if (inc) {
      setSelectedIncident(inc);
    } else {
      try {
        const res = await api.getIncident(incidentId);
        if (res?.incident) setSelectedIncident(res.incident);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const activeViolationsCount = telemetry?.violation_count ?? (analytics?.active_violations ?? 0);

  if (isAdminApp || showSuperAdmin) {
    return (
      <SuperAdminPortal
        standalone={isAdminApp}
        onBackToApp={isAdminApp ? undefined : () => {
          setShowSuperAdmin(false);
          checkLicense();
        }}
      />
    );
  }

  // If company is licensed but operator is not yet signed in via Firebase, require login
  if (licenseStatus?.is_licensed && authInitialized && !currentUser) {
    return (
      <CompanyUserLoginModal
        companyInfo={licenseStatus?.company}
        onAuthenticated={() => {
          loadData();
        }}
      />
    );
  }

  return (
    <div className="flex h-screen bg-[#0B1120] text-[#F8FAFC] overflow-hidden select-none">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={(tab) => setCurrentTab(tab)}
        activeViolationsCount={activeViolationsCount}
        cameraActive={telemetry?.is_active ?? false}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AppHeader
          activeZone={telemetry?.zone || 'Welding Area'}
          activeViolationsCount={activeViolationsCount}
          onRefresh={loadData}
          onOpenSuperAdmin={undefined}
          licenseInfo={licenseStatus}
          currentUserEmail={currentUser?.email}
          onLogout={() => firebaseAuthService.logout()}
        />

        <main className="flex-1 overflow-y-auto p-6">
          {currentTab === 'dashboard' && (
            <DashboardView
              analytics={analytics}
              telemetry={telemetry}
              alerts={alerts}
              onNavigate={(tab) => setCurrentTab(tab)}
              onAlertStatusChange={handleAlertStatusChange}
            />
          )}

          {currentTab === 'live' && (
            <LiveMonitorView
              telemetry={telemetry}
              cameras={cameras}
              availableHardware={availableHardware}
              onStartCamera={handleStartCamera}
              onStopCamera={handleStopCamera}
            />
          )}

          {currentTab === 'video_analysis' && <VideoAnalysisView />}

          {currentTab === 'workers' && (
            <WorkersView
              workers={workers}
              onViewProfile={(w) => {
                setSelectedWorker(w);
                setEditWorkerMode(false);
              }}
              onEditProfile={(w) => {
                setSelectedWorker(w);
                setEditWorkerMode(true);
              }}
              onNavigateRegister={() => setCurrentTab('register')}
              onRefresh={loadData}
            />
          )}

          {currentTab === 'register' && (
            <RegisterWorkerView
              onSuccess={loadData}
              onViewWorker={(w) => setSelectedWorker(w)}
            />
          )}

          {currentTab === 'scan_qr' && <ScanQRView />}

          {currentTab === 'cameras' && (
            <CamerasView
              cameras={cameras}
              availableHardware={availableHardware}
              onRefresh={loadData}
              onSelectCamera={(camId) => {
                handleStartCamera({
                  camera_id: camId,
                  source: '0',
                  source_type: 'webcam',
                  conf_thresh: 0.35,
                  model_choice: 'hansung'
                });
                setCurrentTab('live');
              }}
            />
          )}

          {currentTab === 'alerts' && (
            <AlertsView
              alerts={alerts}
              onAlertStatusChange={handleAlertStatusChange}
              onViewIncident={handleViewIncidentById}
              onDeleteAlert={handleDeleteAlert}
              onClearAllAlerts={handleClearAllAlerts}
            />
          )}

          {currentTab === 'incidents' && (
            <IncidentsView
              incidents={incidents}
              onViewDetail={(inc) => setSelectedIncident(inc)}
              onDeleteIncident={handleDeleteIncident}
              onClearAllIncidents={handleClearAllIncidents}
            />
          )}

          {currentTab === 'analytics' && <AnalyticsView analytics={analytics} />}

          {currentTab === 'settings' && <SettingsView onRefreshAll={loadData} />}
        </main>
      </div>

      {/* Popups & Modals */}
      <WorkerProfileModal
        worker={selectedWorker}
        initialEditMode={editWorkerMode}
        onClose={() => {
          setSelectedWorker(null);
          setEditWorkerMode(false);
        }}
        onWorkerUpdated={(updated) => {
          setSelectedWorker(updated);
          loadData();
        }}
      />

      <IncidentDetailModal
        incident={selectedIncident}
        onClose={() => setSelectedIncident(null)}
        onDelete={handleDeleteIncident}
      />

      {showLicenseModal && (
        <LicenseActivationModal
          licenseStatus={licenseStatus}
          onActivated={() => {
            checkLicense();
            loadData();
          }}
          onClose={licenseStatus?.is_licensed ? () => setShowLicenseModal(false) : undefined}
        />
      )}
    </div>
  );
};

export default App;
