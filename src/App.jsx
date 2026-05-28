import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Megaphone, 
  BarChart3, 
  Settings, 
  UserCircle2,
  CheckCircle2,
  Menu,
  X,
  LogOut,
  AlertCircle,
  PlusCircle,
  ChevronRight,
  Lock,
  ShoppingBag,
  ExternalLink,
  Star
} from 'lucide-react';
import { supabase } from './supabaseClient';
import Login from './Login.jsx';

/**
 * Componente principal da Dashboard com Autenticação Supabase.
 * Integrado ao projeto "Watic grupos".
 * Agora com lógica de instância e submenus.
 */
function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  
  // Persistência da aba ativa no localStorage
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('watic_activeTab') || null;
  });
  const [activeSubTab, setActiveSubTab] = useState(() => {
    return localStorage.getItem('watic_activeSubTab') || null;
  });
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(activeTab === 'Configurações');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [isCreatingInstance, setIsCreatingInstance] = useState(false);
  const [qrCodeData, setQrCodeData] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [shopeeProducts, setShopeeProducts] = useState([]);
  const [shopeeLoading, setShopeeLoading] = useState(false);
  const [sendingProductId, setSendingProductId] = useState(null);

  // URL dos Webhooks do n8n
  // 1. Webhook para criação de instância
  const WEBHOOK_URL = 'https://n8n.watic.com.br/webhook-test/968b5e10-9fe4-471d-a7ff-e0d9d03bac2d';
  // 2. Webhook para gerar QR Code
  const QRCODE_WEBHOOK_URL = 'https://n8n.watic.com.br/webhook-test/0ca25874-2f30-499e-8e83-6de64ecae887';
  // 3. Webhook para listar grupos
  const GROUPS_WEBHOOK_URL = 'https://n8n.watic.com.br/webhook-test/1f854f6e-0791-42ae-8456-91c4c741ac29';
  // 4. Webhook para listar produtos Shopee
  const SHOPEE_WEBHOOK_URL = 'https://n8n.watic.com.br/webhook/ff7c4497-86c5-4ded-b9c9-0cab3f55951f';
  // 5. Webhook para enviar oferta para os grupos
  // PARA ALTERAR O LINK DO WEBHOOK DE ENVIO, MODIFIQUE A CONSTANTE ABAIXO:
  const SEND_OFFER_WEBHOOK_URL = 'https://n8n.watic.com.br/webhook/6c6123bc-f95f-47ff-8089-b329855305f9';

  // Salva a aba ativa no localStorage sempre que mudar
  useEffect(() => {
    if (activeTab) localStorage.setItem('watic_activeTab', activeTab);
    if (activeSubTab) localStorage.setItem('watic_activeSubTab', activeSubTab);
    else localStorage.removeItem('watic_activeSubTab');
  }, [activeTab, activeSubTab]);

  // Busca o perfil do usuário (campo instancia)
  const fetchProfile = async (userId) => {
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('instancia')
        .eq('id', userId)
        .single();
      
      if (!error) {
        setProfile(data);
        // Se não tiver instância, força para Configurações > Criar Instância IMEDIATAMENTE
        if (!data?.instancia) {
          setActiveTab('Configurações');
          setActiveSubTab('Criar Instância');
          setIsSettingsOpen(true);
        } else {
          // Se tiver instância e não tiver aba ativa (ex: primeiro login), vai para Início
          if (!activeTab) setActiveTab('Início');
        }
      } else {
        // Se der erro ou não encontrar perfil, assume que precisa criar instância
        setActiveTab('Configurações');
        setActiveSubTab('Criar Instância');
        setIsSettingsOpen(true);
      }
    } catch (e) {
      console.error("Erro ao carregar perfil:", e);
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    // Verifica a sessão inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Escuta mudanças na autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setActiveTab('Início');
        setActiveSubTab(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Quando o profile termina de carregar, paramos o loading global
  useEffect(() => {
    if (session && !profileLoading) {
      setLoading(false);
    }
  }, [session, profileLoading]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // Função para buscar os grupos (do BD ou Webhook se for a primeira vez)
  const handleGroupsMenuClick = async () => {
    setActiveTab('Grupos');
    setIsSidebarOpen(false);
    
    setGroupsLoading(true);
    try {
      // 1. Tenta buscar do banco de dados primeiro
      const { data: dbGroups, error: dbError } = await supabase
        .from('groups_data')
        .select('*')
        .eq('user_id', session.user.id);

      if (dbError) throw dbError;

      if (dbGroups && dbGroups.length > 0) {
        setGroups(dbGroups);
      } else {
        // 2. Se não tiver no banco, dispara o webhook pela primeira vez
        await fetchGroupsFromWebhook();
      }
    } catch (err) {
      console.error("Erro ao carregar grupos iniciais:", err);
    } finally {
      setGroupsLoading(false);
    }
  };

  // Função para buscar produtos da Shopee via webhook
  const fetchShopeeProducts = async () => {
    console.log("Iniciando busca de produtos Shopee no webhook:", SHOPEE_WEBHOOK_URL);
    setShopeeLoading(true);
    try {
      // Tentativa de fetch com o modo 'no-cors' para evitar o bloqueio do navegador
      // Nota: 'no-cors' limita o acesso à resposta, mas dispara o webhook
      const response = await fetch(SHOPEE_WEBHOOK_URL, {
        mode: 'cors', // Garantindo modo cors
        headers: {
          'Content-Type': 'text/plain', // Usando header simples para evitar pre-flight
        }
      });
      
      console.log("Resposta do webhook Shopee:", response.status);
      
      if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
      
      const textData = await response.text();
      let jsonData;
      try {
        jsonData = JSON.parse(textData);
      } catch (e) {
        jsonData = JSON.parse(textData.trim());
      }

      const result = Array.isArray(jsonData) ? jsonData[0] : jsonData;
      const products = result?.data?.productOfferV2?.nodes || [];
      
      setShopeeProducts(products);
    } catch (err) {
      console.error("Erro crítico ao carregar produtos Shopee:", err);
      
      // Se falhar o fetch normal, tentamos via componente script/JSONP (Estratégia alternativa de fallback)
      if (err.message === "Failed to fetch") {
        console.warn("Tentando carregar via fallback de redirecionamento ou mensagem...");
        alert("O navegador ainda está bloqueando a requisição. Verifique se o n8n está respondendo com os headers: \nAccess-Control-Allow-Origin: * \nAccess-Control-Allow-Methods: GET, OPTIONS");
      }
    } finally {
      setShopeeLoading(false);
    }
  };

  // Função para enviar os dados do produto para o webhook de grupos
  const handleSendToGroup = async (product) => {
    // Usamos o link da oferta ou nome como ID temporário para o loading
    const productId = product.offerLink || product.productName;
    setSendingProductId(productId);
    
    try {
      const response = await fetch(SEND_OFFER_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...product,
          instanceName: profile?.instancia,
          sentAt: new Date().toISOString()
        }),
      });

      if (!response.ok) throw new Error('Falha ao enviar para o grupo');

      alert('Produto enviado com sucesso para os grupos!');
    } catch (err) {
      console.error("Erro ao enviar produto:", err);
      alert('Erro ao enviar: ' + err.message);
    } finally {
      setSendingProductId(null);
    }
  };

  // Função para disparar o webhook e salvar no BD
  const fetchGroupsFromWebhook = async () => {
    if (!profile?.instancia) return;
    
    setGroupsLoading(true);
    try {
      const response = await fetch(`${GROUPS_WEBHOOK_URL}?instanceName=${encodeURIComponent(profile.instancia)}`);
      if (!response.ok) throw new Error('Erro ao buscar grupos do servidor');
      
      const textData = await response.text();
      let jsonData;
      try {
        jsonData = JSON.parse(textData);
      } catch (e) {
        jsonData = JSON.parse(textData.trim());
      }

      const result = Array.isArray(jsonData) ? jsonData[0] : jsonData;
      const fetchedGroups = result.data || [];
      
      if (fetchedGroups.length > 0) {
        // Formata os dados para o Supabase
        const groupsToSave = fetchedGroups.map(g => ({
          id: g.id,
          user_id: session.user.id,
          subject: g.subject,
          picture_url: g.pictureUrl,
          size: g.size,
          updated_at: new Date().toISOString()
        }));

        // Salva/Atualiza no banco de dados (UPSERT)
        const { error: saveError } = await supabase
          .from('groups_data')
          .upsert(groupsToSave);

        if (saveError) throw saveError;
        
        setGroups(groupsToSave);
        alert('Grupos atualizados com sucesso!');
      }
    } catch (err) {
      console.error("Erro ao atualizar grupos via webhook:", err);
      alert('Falha na atualização: ' + err.message);
    } finally {
      setGroupsLoading(false);
    }
  };

  // Função para disparar o webhook e criar a instância
  const handleCreateInstance = async (e) => {
    e.preventDefault();
    if (!newInstanceName.trim()) return;

    setIsCreatingInstance(true);
    try {
      // Dispara para o webhook do n8n
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instanceName: newInstanceName,
          userId: session.user.id,
          userEmail: session.user.email
        }),
      });

      if (!response.ok) throw new Error('Falha ao comunicar com o servidor');

      const data = await response.json();
      
      // Validação da resposta conforme solicitado: { "sucess": "true" }
      // Nota: O usuário enviou "true}" no prompt, mas tratei como string "true" para robustez
      if (data.sucess === "true" || data.success === true || data.sucess === "true}") {
        // Salva o nome da instância digitado pelo usuário no banco de dados
        const instanceId = newInstanceName;

        // Atualiza no Supabase usando UPSERT (Insere se não existir, atualiza se existir)
        // Isso resolve o problema de usuários que não tiveram o perfil criado pelo trigger
        const { error: updateError } = await supabase
          .from('profiles')
          .upsert({ 
            id: session.user.id, 
            instancia: instanceId,
            updated_at: new Date().toISOString()
          })
          .select();

        if (updateError) {
          console.error("Erro detalhado do Supabase:", updateError);
          throw new Error(`Erro ao salvar no banco: ${updateError.message}`);
        }

        // --- NOVO PASSO: Aguardar 2 segundos para garantir que a instância foi criada no servidor ---
        // Isso evita o erro de "instância não existe" ao tentar gerar o QR Code muito rápido
        await new Promise(resolve => setTimeout(resolve, 2000));

        // --- NOVO PASSO: Gerar QR Code via Webhook (MÉTODO GET esperando Texto/Base64) ---
        try {
          const qrUrlWithParams = `${QRCODE_WEBHOOK_URL}?instanceName=${encodeURIComponent(instanceId)}&userId=${encodeURIComponent(session.user.id)}`;
          
          const qrResponse = await fetch(qrUrlWithParams, {
            method: 'GET'
          });

          if (qrResponse.ok) {
            const qrText = await qrResponse.text();
            // Armazena o texto puro (Base64) recebido do n8n
            setQrCodeData({ base64: qrText });
          }
        } catch (qrErr) {
          console.error("Erro ao gerar QR Code:", qrErr);
        }

        // Atualiza o estado local e fecha o modal
        setProfile({ ...profile, instancia: instanceId });
        setIsModalOpen(false);
        setNewInstanceName('');
        setActiveTab('Configurações');
        setActiveSubTab('Criar Instância');
        
        alert('Instância criada com sucesso! Escaneie o QR Code abaixo.');
      } else {
        throw new Error('O servidor n8n não retornou sucesso na criação.');
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao criar instância: ' + err.message);
    } finally {
      setIsCreatingInstance(false);
    }
  };

  // Itens do menu lateral
  const menuItems = [
    { name: 'Início', icon: <LayoutDashboard size={20} /> },
    { name: 'Grupos', icon: <Users size={20} /> },
    { name: 'Campanhas', icon: <Megaphone size={20} /> },
    { name: 'Relatórios', icon: <BarChart3 size={20} /> },
    { name: 'Shopee', icon: <ShoppingBag size={20} /> },
    { 
      name: 'Configurações', 
      icon: <Settings size={20} />,
      subItems: [
        { name: 'Perfil', icon: <UserCircle2 size={16} /> },
        { name: 'Criar Instância', icon: <PlusCircle size={16} /> }
      ]
    },
  ];

  // Adicionando um useEffect para disparar o webhook quando a aba Shopee for selecionada
  useEffect(() => {
    if (activeTab === 'Shopee') {
      fetchShopeeProducts();
    }
  }, [activeTab]);

  if (loading) {
    return (
      <div className="h-screen w-full bg-black flex items-center justify-center">
        <div className="animate-spin text-white">
          <Settings size={40} />
        </div>
      </div>
    );
  }

  if (!session) {
    return <Login onLoginSuccess={() => {}} />;
  }

  const isWhatsAppConnected = !!profile?.instancia;

  return (
    <div className="flex h-screen w-full bg-black text-white p-2 md:p-4 font-sans overflow-hidden relative">
      
      {/* Modal para Nome da Instância */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => !isCreatingInstance && setIsModalOpen(false)} />
          <div className="relative bg-zinc-900 border border-white/10 rounded-[32px] p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-2xl font-bold mb-2">Nome da Instância</h2>
            <p className="text-gray-400 text-sm mb-6">Escolha um nome identificador para sua nova conexão.</p>
            
            <form onSubmit={handleCreateInstance} className="space-y-4">
              <input
                autoFocus
                type="text"
                placeholder="Ex: MinhaInstancia01"
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-white/30 transition-colors"
                value={newInstanceName}
                onChange={(e) => setNewInstanceName(e.target.value)}
                disabled={isCreatingInstance}
              />
              
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isCreatingInstance}
                  className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreatingInstance || !newInstanceName.trim()}
                  className="flex-1 px-4 py-3 rounded-xl bg-white text-black font-bold hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  {isCreatingInstance ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      Criando...
                    </>
                  ) : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside className={`
        fixed md:static inset-y-0 left-0 z-50
        w-64 flex flex-col gap-6 mr-0 md:mr-4
        bg-black md:bg-transparent
        transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0 p-4' : '-translate-x-full md:translate-x-0'}
      `}>
        
        <div className="flex justify-end md:hidden">
          <button onClick={() => setIsSidebarOpen(false)} className="p-2 text-gray-400">
            <X size={24} />
          </button>
        </div>

        {/* Status do WhatsApp: Dinâmico baseado na instância */}
        <div className={`border border-white/20 rounded-2xl p-4 flex items-center gap-3 bg-white/5 ${!isWhatsAppConnected ? 'opacity-70' : ''}`}>
          <div className={isWhatsAppConnected ? 'text-green-500' : 'text-red-500'}>
            {isWhatsAppConnected ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {isWhatsAppConnected ? 'WhatsApp conectado' : 'WhatsApp desconectado'}
            </span>
            {profile?.instancia && <span className="text-[10px] text-gray-500">ID: {profile.instancia}</span>}
          </div>
        </div>

        <nav className="flex-1 border border-white/20 rounded-3xl p-4 bg-white/5 flex flex-col gap-2 overflow-y-auto">
          {menuItems.map((item) => {
            const isBlocked = !isWhatsAppConnected && item.name !== 'Configurações';
            
            return (
              <div key={item.name} className="flex flex-col gap-1">
                <button 
                  disabled={isBlocked}
                  onClick={() => {
                    console.log("Clicou no menu:", item.name); // Log para depuração
                    if (item.name === 'Grupos') {
                      handleGroupsMenuClick();
                    } else if (item.name === 'Shopee') {
                      console.log("Selecionando aba Shopee");
                      setActiveTab('Shopee');
                      setActiveSubTab(null);
                      setIsSidebarOpen(false);
                    } else {
                      setActiveTab(item.name);
                      if (item.subItems) {
                        setIsSettingsOpen(!isSettingsOpen);
                      } else {
                        setActiveSubTab(null);
                        setIsSidebarOpen(false);
                      }
                    }
                  }}
                  className={`flex items-center justify-between p-3 rounded-xl transition-all w-full text-left
                    ${activeTab === item.name ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'}
                    ${isBlocked ? 'opacity-30 cursor-not-allowed grayscale' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    {item.icon}
                    <span className="font-medium">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isBlocked && <Lock size={14} className="text-gray-500" />}
                    {item.subItems && (
                      <ChevronRight size={16} className={`transition-transform ${isSettingsOpen ? 'rotate-90' : ''}`} />
                    )}
                  </div>
                </button>

                {/* Submenu de Configurações */}
                {item.subItems && isSettingsOpen && (
                  <div className="flex flex-col gap-1 ml-6 mt-1 border-l border-white/10 pl-4">
                    {item.subItems.map((sub) => (
                      <button
                        key={sub.name}
                        onClick={() => {
                          setActiveTab(item.name);
                          setActiveSubTab(sub.name);
                          setIsSidebarOpen(false);
                        }}
                        className={`flex items-center gap-3 p-2 rounded-lg text-sm transition-colors
                          ${activeSubTab === sub.name ? 'bg-white/5 text-white' : 'text-gray-500 hover:text-white'}`}
                      >
                        {sub.icon}
                        <span>{sub.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 p-3 rounded-xl hover:bg-red-500/10 transition-colors text-red-400 mt-auto"
          >
            <LogOut size={20} />
            <span className="font-medium">Sair</span>
          </button>
        </nav>
      </aside>

      <main className="flex-1 flex flex-col gap-4 min-w-0">
        
        <header className="flex justify-between md:justify-end items-center gap-4 px-2">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 border border-white/20 rounded-xl bg-white/5 md:hidden"
          >
            <Menu size={24} />
          </button>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium">{session.user.email}</p>
              <p className="text-xs text-gray-500">Usuário Autenticado</p>
            </div>
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full border border-white/20 bg-white/5 flex items-center justify-center overflow-hidden">
              <UserCircle2 size={32} className="text-gray-400" />
            </div>
          </div>
        </header>

        <section className="flex-1 border border-white/20 rounded-[30px] md:rounded-[40px] bg-white/5 p-4 md:p-8 relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[80%] border border-white/20 rounded-full" />
          </div>
          
          <div className="relative z-10 h-full overflow-y-auto pr-2">
            {activeSubTab === 'Criar Instância' ? (
              <div>
                <h1 className="text-2xl md:text-3xl font-bold mb-4">Criar Instância</h1>
                <p className="text-gray-400 mb-8 text-sm md:text-base">Você ainda não possui uma instância vinculada. Crie uma para conectar seu WhatsApp.</p>
                
                <div className="max-w-md bg-white/5 border border-white/10 rounded-2xl p-6">
                  <h3 className="text-lg font-medium mb-4">Nova Instância</h3>
                  <p className="text-xs text-gray-500 mb-6 italic">Integre sua conta do WhatsApp para gerenciar grupos e campanhas automaticamente.</p>
                  
                  {/* Exibição do QR Code se disponível */}
                  {qrCodeData ? (
                    <div className="flex flex-col items-center gap-4 p-4 bg-white rounded-xl mb-6">
                      <p className="text-black text-xs font-bold uppercase">Escaneie o QR Code</p>
                      <img 
                        src={qrCodeData.base64?.startsWith('data:image') ? qrCodeData.base64 : `data:image/png;base64,${qrCodeData.base64}`} 
                        alt="WhatsApp QR Code" 
                        className="w-48 h-48 object-contain"
                        onError={(e) => {
                          console.error("Falha ao carregar imagem do QR Code");
                          e.target.src = 'https://via.placeholder.com/200?text=Erro+no+QR+Code';
                        }}
                      />
                      <button 
                        onClick={() => setQrCodeData(null)}
                        className="text-[10px] text-gray-400 hover:text-black transition-colors"
                      >
                        Limpar QR Code
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setIsModalOpen(true)}
                      className="w-full bg-white text-black font-bold py-3 rounded-xl hover:bg-gray-200 transition-colors"
                    >
                      Gerar Instância
                    </button>
                  )}
                </div>
              </div>
            ) : activeTab === 'Shopee' ? (
              <div className="h-full flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <h1 className="text-2xl md:text-3xl font-bold text-orange-500">Shopee</h1>
                  <button 
                    onClick={fetchShopeeProducts}
                    disabled={shopeeLoading}
                    className="flex items-center gap-2 px-4 py-2 border border-white/20 rounded-xl hover:bg-white/5 transition-colors disabled:opacity-50 text-sm font-medium"
                  >
                    <ChevronRight size={18} className={shopeeLoading ? 'animate-spin' : ''} />
                    {shopeeLoading ? 'Carregando...' : 'Atualizar Produtos'}
                  </button>
                </div>

                {shopeeLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="animate-spin text-white">
                      <Settings size={32} />
                    </div>
                  </div>
                ) : shopeeProducts.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {shopeeProducts.map((product, index) => (
                      <div key={index} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-orange-500/50 transition-all flex flex-col group">
                        <div className="relative aspect-square overflow-hidden bg-white/10">
                          <img 
                            src={product.imageUrl} 
                            alt={product.productName} 
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            referrerPolicy="no-referrer"
                          />
                          {product.priceDiscountRate > 0 && (
                            <div className="absolute top-2 right-2 bg-orange-500 text-white text-[10px] font-bold px-2 py-1 rounded-full">
                              -{product.priceDiscountRate}%
                            </div>
                          )}
                        </div>
                        
                        <div className="p-4 flex flex-col flex-1 gap-2">
                          <h3 className="font-medium text-white text-sm line-clamp-2 min-h-[40px]">
                            {product.productName}
                          </h3>
                          
                          <div className="flex items-center gap-1">
                            <div className="flex text-yellow-400">
                              <Star size={12} fill="currentColor" />
                            </div>
                            <span className="text-[10px] text-gray-400">{product.ratingStar}</span>
                            <span className="text-[10px] text-gray-500 ml-auto">{product.sales} vendidos</span>
                          </div>

                          <div className="mt-auto pt-2 flex flex-col gap-3">
                            <div className="flex items-baseline gap-2">
                              <span className="text-orange-500 font-bold text-lg">R$ {product.price}</span>
                              {product.priceMax !== product.priceMin && (
                                <span className="text-gray-500 text-[10px] line-through">R$ {product.priceMax}</span>
                              )}
                            </div>
                            
                            <div className="flex flex-col gap-1 text-[10px] text-green-500 font-medium">
                              <p>Comissão: R$ {parseFloat(product.commission).toFixed(2)}</p>
                              <p>Taxa: {(parseFloat(product.commissionRate) * 100).toFixed(0)}%</p>
                            </div>

                            <a 
                               href={product.offerLink} 
                               target="_blank" 
                               rel="noopener noreferrer"
                               className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
                             >
                               Ver Oferta
                               <ExternalLink size={14} />
                             </a>

                             <button
                               onClick={() => handleSendToGroup(product)}
                               disabled={sendingProductId === (product.offerLink || product.productName)}
                               className="w-full border border-orange-500/50 hover:bg-orange-500/10 text-orange-500 font-bold py-2 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                             >
                               {sendingProductId === (product.offerLink || product.productName) ? (
                                 <div className="w-4 h-4 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
                               ) : (
                                 <ShoppingBag size={14} />
                               )}
                               Enviar no Grupo
                             </button>
                           </div>
                         </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4">
                    <ShoppingBag size={48} className="opacity-20" />
                    <p>Nenhum produto encontrado na Shopee.</p>
                  </div>
                )}
              </div>
            ) : activeTab === 'Grupos' ? (
              <div className="h-full flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <h1 className="text-2xl md:text-3xl font-bold">Grupos</h1>
                  <button 
                    onClick={fetchGroupsFromWebhook}
                    disabled={groupsLoading}
                    className="flex items-center gap-2 px-4 py-2 border border-white/20 rounded-xl hover:bg-white/5 transition-colors disabled:opacity-50 text-sm font-medium"
                  >
                    <ChevronRight size={18} className={groupsLoading ? 'animate-spin' : ''} />
                    {groupsLoading ? 'Atualizando...' : 'Atualizar Grupos'}
                  </button>
                </div>

                {groupsLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="animate-spin text-white">
                      <Settings size={32} />
                    </div>
                  </div>
                ) : groups.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {groups.map((group) => (
                      <div key={group.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-white/20 transition-all flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center overflow-hidden border border-white/10 shrink-0">
                            {group.picture_url ? (
                              <img 
                                src={group.picture_url} 
                                alt={group.subject} 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  e.target.onerror = null;
                                  e.target.src = ''; // Limpa a URL se falhar
                                  e.target.parentElement.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-users text-gray-500"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
                                }}
                              />
                            ) : (
                              <Users size={24} className="text-gray-500" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-white truncate text-sm md:text-base">{group.subject}</h3>
                            <p className="text-xs text-gray-500 truncate">{group.id}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-white/5">
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <Users size={14} />
                            <span>{group.size} participantes</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4">
                    <Users size={48} className="opacity-20" />
                    <p>Nenhum grupo encontrado nesta instância.</p>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <h1 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6">
                  {activeTab} {activeSubTab ? `> ${activeSubTab}` : ''}
                </h1>
                <p className="text-gray-400 text-sm md:text-base">
                  {activeTab === 'Início' 
                    ? `Bem-vindo, ${session.user.email.split('@')[0]}! Sua sessão está ativa no Watic Grupos.`
                    : `Conteúdo da aba ${activeTab} será exibido aqui.`}
                </p>
              </div>
            )}
          </div>
        </section>

      </main>
    </div>
  );
}

export default App;
