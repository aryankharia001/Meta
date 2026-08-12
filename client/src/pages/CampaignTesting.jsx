import { useEffect, useState } from "react";
import axios from "axios";
import { fetchLiveAdAccounts } from "../lib/api";
import { useSelectedToken } from "../lib/useSelectedToken";

export default function CampaignTesting() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();

  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);

  const today = new Date().toISOString().split("T")[0];

  const [since, setSince] = useState(today);
  const [until, setUntil] = useState(today);

  const [campaigns, setCampaigns] = useState([]);

  const [totalSpend, setTotalSpend] = useState(0);
  const [loading, setLoading] = useState(false);

  const [sortConfig, setSortConfig] = useState({
    key: null,
    direction: "asc",
  });


  useEffect(() => {
    if (TOKEN_ID) fetchAdAccounts();
  }, [TOKEN_ID]);



  // Pulled live from the Meta Graph API (GET /api/adaccounts/adaccounts/:tokenId)
  // instead of the local Mongo AdAccount collection, which is only ever
  // populated by a manual sync — so it was showing up empty here.
  const fetchAdAccounts = async () => {
    try {
      const res = await fetchLiveAdAccounts(TOKEN_ID);
      if (!res.success) throw new Error(res.message || "Failed to fetch ad accounts");

      // Normalize to the { adAccountId, name } shape the rest of this page
      // already expects, so nothing else here has to change.
      const accounts = (res.adAccounts || []).map((a) => ({
        adAccountId: a.id,
        name: a.name,
      }));

      setAdAccounts(accounts);

      setSelectedAccounts(
        accounts.map((a) => a.adAccountId)
      );

    } catch (err) {
      console.error(err);
    }
  };



  const toggleAccount = (id) => {
    setSelectedAccounts((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id]
    );
  };


  const selectAll = () => {
    setSelectedAccounts(
      adAccounts.map((a) => a.adAccountId)
    );
  };


  const clearAll = () => {
    setSelectedAccounts([]);
  };



  const fetchCampaigns = async () => {

    if (!selectedAccounts.length)
      return;


    setLoading(true);


    try {

      const requests = selectedAccounts.map(
        (accountId) =>
          axios.get(
            `/api/campaigns/${TOKEN_ID}/date-range`,
            {
              params:{
                adAccountId: accountId,
                since,
                until
              }
            }
          )
      );


      const responses = await Promise.all(requests);


      let allCampaigns = [];


      responses.forEach((res,index)=>{

        const accountId =
          selectedAccounts[index];


        const data =
          res.data.campaigns || [];


        allCampaigns.push(
          ...data.map(c=>({
            ...c,
            accountId
          }))
        );

      });



      setCampaigns(allCampaigns);


      const total =
        allCampaigns.reduce(
          (sum,c)=>
            sum + Number(c.spend || 0),
          0
        );


      setTotalSpend(total);


    } catch(err){

      console.error(err);

      alert(
        "Failed to fetch campaigns"
      );

    }


    setLoading(false);

  };



  // -----------------------
  // Sorting
  // -----------------------

  const handleSort = (key) => {

    let direction = "asc";


    if (
      sortConfig.key === key &&
      sortConfig.direction === "asc"
    ) {
      direction = "desc";
    }


    setSortConfig({
      key,
      direction
    });

  };



  const sortedCampaigns = [...campaigns].sort((a,b)=>{

    if(!sortConfig.key)
      return 0;


    let x = a[sortConfig.key];
    let y = b[sortConfig.key];


    if(
      ["spend","impressions","clicks","ctr"].includes(
        sortConfig.key
      )
    ){
      x = Number(x || 0);
      y = Number(y || 0);
    }
    else{
      x = String(x || "").toLowerCase();
      y = String(y || "").toLowerCase();
    }


    if(x < y)
      return sortConfig.direction === "asc"
        ? -1
        : 1;


    if(x > y)
      return sortConfig.direction === "asc"
        ? 1
        : -1;


    return 0;

  });



  const sortArrow = (key)=>{

    if(sortConfig.key !== key)
      return "";


    return sortConfig.direction === "asc"
      ? " ↑"
      : " ↓";

  };



  return (

    <div className="max-w-[1400px] mx-auto p-6">

      <h2 className="text-xl font-semibold text-slate-800 mb-4">
        Meta Campaign Spend Report
      </h2>

      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-slate-600">
          Token:
        </label>
        <select
          className="input w-auto"
          value={TOKEN_ID || ""}
          onChange={(e) => setTokenId(e.target.value)}
        >
          {tokens.length === 0 && <option value={TOKEN_ID}>{TOKEN_ID}</option>}
          {tokens.map((t) => (
            <option key={t._id} value={t._id}>
              {t.label || t._id}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-slate-600 mb-4">
        Date Range:
        {" "}
        <b className="text-slate-800">{since}</b>
        {" → "}
        <b className="text-slate-800">{until}</b>
      </p>


      <hr className="border-slate-200 mb-5" />



      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
        Ad Accounts
      </h3>


      <div className="flex gap-2 mb-3">
        <button className="btn btn-secondary btn-sm" onClick={selectAll}>
          Select All
        </button>


        <button
          className="btn btn-secondary btn-sm"
          onClick={clearAll}
        >
          Clear
        </button>
      </div>



      <div className="flex flex-wrap gap-2 mt-3">

        {
          adAccounts.map(account=>(

            <label
              key={account.adAccountId}
              className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                selectedAccounts.includes(account.adAccountId)
                  ? "bg-blue-50 border-blue-200 text-blue-700"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >

              <input
                type="checkbox"
                checked={
                  selectedAccounts.includes(
                    account.adAccountId
                  )
                }
                onChange={() =>
                  toggleAccount(
                    account.adAccountId
                  )
                }
              />

              {account.name}
              {" "}
              ({account.adAccountId})

            </label>

          ))
        }

      </div>



      <div className="flex items-center gap-3 mt-6 mb-2 flex-wrap">

        <input
          type="date"
          className="input w-auto"
          value={since}
          onChange={(e)=>setSince(e.target.value)}
        />


        <span className="text-sm text-slate-500">
          To
        </span>


        <input
          type="date"
          className="input w-auto"
          value={until}
          onChange={(e)=>setUntil(e.target.value)}
        />


        <button
          className="btn btn-primary"
          onClick={fetchCampaigns}
        >
          Fetch
        </button>

      </div>




      {
        campaigns.length > 0 &&

        <div className="flex gap-5 my-6 flex-wrap">

          <div className="card min-w-[200px]">
            <h4 className="text-sm text-slate-500 mb-1">
              Campaigns
            </h4>

            <h2 className="text-2xl font-bold text-slate-800">
              {campaigns.length}
            </h2>
          </div>


          <div className="card min-w-[200px]">
            <h4 className="text-sm text-slate-500 mb-1">
              Total Spend
            </h4>

            <h2 className="text-2xl font-bold text-slate-800">
              ₹{totalSpend.toFixed(2)}
            </h2>
          </div>


        </div>
      }




      {
        loading &&
        <div className="flex items-center gap-2 text-slate-500 text-sm my-4">
          <span className="spinner" /> Loading…
        </div>
      }





      {
        !loading &&
        campaigns.length > 0 &&

        <div className="card p-0 overflow-x-auto">
        <table className="table">

          <thead>

            <tr>

              {[
                ["accountId","Account"],
                ["campaign_name","Campaign"],
                ["campaign_id","Campaign ID"],
                ["spend","Spend"],
                ["impressions","Impressions"],
                ["clicks","Clicks"],
                ["ctr","CTR"],
                ["date_start","Start"],
                ["date_stop","End"]
              ].map(([key,label])=>(

                <th
                  key={key}
                  className="cursor-pointer select-none"
                  onClick={()=>handleSort(key)}
                >
                  {label}
                  {sortArrow(key)}
                </th>

              ))}

            </tr>

          </thead>



          <tbody>

          {
            sortedCampaigns.map(c=>(

              <tr
                key={`${c.accountId}-${c.campaign_id}`}
              >

                <td>
                  {c.accountId}
                </td>

                <td>
                  {c.campaign_name}
                </td>

                <td>
                  {c.campaign_id}
                </td>

                <td>
                  {c.spend}
                </td>

                <td>
                  {c.impressions}
                </td>

                <td>
                  {c.clicks}
                </td>

                <td>
                  {c.ctr}
                </td>

                <td>
                  {c.date_start || since}
                </td>

                <td>
                  {c.date_stop || until}
                </td>

              </tr>

            ))
          }

          </tbody>


        </table>
        </div>

      }


    </div>
  );
}