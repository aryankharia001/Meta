import { useState } from "react";
import axios from "axios";

export default function OrdersTesting() {
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [expandedCampaign, setExpandedCampaign] = useState(null);

  const [sortConfig, setSortConfig] = useState({
    key: null,
    direction: "asc",
  });



  const fetchOrders = async () => {
    try {
      setLoading(true);

      const res = await axios.get(
        "http://localhost:5000/api/orders/orders",
        {
          params: {
            since,
            until,
          },
        }
      );

      setData(res.data);

    } catch (err) {
      console.error(err);
      alert("Failed to fetch orders");

    } finally {
      setLoading(false);
    }
  };



  const toggleCampaign = (campaignId) => {
    setExpandedCampaign((prev) =>
      prev === campaignId
        ? null
        : campaignId
    );
  };



  // Sorting
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
      direction,
    });

  };



  const sortedCampaigns = () => {

    if (!data)
      return [];


    const campaigns = [
      ...data.campaigns
    ];


    if (!sortConfig.key)
      return campaigns;



    return campaigns.sort((a,b)=>{

      let x = a[sortConfig.key];
      let y = b[sortConfig.key];


      if (
        typeof x === "string"
      ) {
        x = x.toLowerCase();
        y = y.toLowerCase();
      }


      if (x < y)
        return sortConfig.direction === "asc"
          ? -1
          : 1;


      if (x > y)
        return sortConfig.direction === "asc"
          ? 1
          : -1;


      return 0;

    });

  };



  const campaignsList = sortedCampaigns();



  const arrow = (key) => {

    if(sortConfig.key !== key)
      return "";

    return sortConfig.direction === "asc"
      ? " ↑"
      : " ↓";

  };



  return (
    <div className="max-w-[1200px] mx-auto p-6">


      <h2 className="text-xl font-semibold text-slate-800 mb-4">
        Campaign Orders Report
      </h2>



      <div className="flex gap-3 mb-5 items-center flex-wrap">

        <input
          type="date"
          className="input w-auto"
          value={since}
          onChange={(e)=>setSince(e.target.value)}
        />


        <input
          type="date"
          className="input w-auto"
          value={until}
          onChange={(e)=>setUntil(e.target.value)}
        />


        <button className="btn btn-primary" onClick={fetchOrders} disabled={loading}>
          {loading ? "Loading..." : "Fetch"}
        </button>

      </div>




      {
        data &&

        <>


          <div className="flex gap-5 mb-6 flex-wrap">

            <div className="card min-w-[160px]">
              <div className="text-sm text-slate-500 mb-1">Total Orders</div>
              <div className="text-2xl font-bold text-slate-800">{data.totalOrders}</div>
            </div>


            <div className="card min-w-[160px]">
              <div className="text-sm text-slate-500 mb-1">Total Payout</div>
              <div className="text-2xl font-bold text-slate-800">₹{data.totalPayout}</div>
            </div>


            <div className="card min-w-[160px]">
              <div className="text-sm text-slate-500 mb-1">Campaigns</div>
              <div className="text-2xl font-bold text-slate-800">{data.campaigns.length}</div>
            </div>


          </div>




          <div className="card p-0 overflow-x-auto">
          <table className="table">


            <thead>

              <tr>


                <th
                  className="cursor-pointer select-none"
                  onClick={()=>handleSort("campaignName")}
                >
                  Campaign {arrow("campaignName")}
                </th>



                <th
                  className="cursor-pointer select-none"
                  onClick={()=>handleSort("campaignId")}
                >
                  Campaign ID {arrow("campaignId")}
                </th>



                <th
                  className="cursor-pointer select-none"
                  onClick={()=>handleSort("totalOrders")}
                >
                  Orders {arrow("totalOrders")}
                </th>



                <th
                  className="cursor-pointer select-none"
                  onClick={()=>handleSort("totalPayout")}
                >
                  Payout {arrow("totalPayout")}
                </th>


              </tr>

            </thead>



            <tbody>


            {
              campaignsList.map(
                (campaign)=>(

                  <>

                    <tr

                      key={campaign.campaignId}

                      onClick={() =>
                        toggleCampaign(
                          campaign.campaignId
                        )
                      }

                      className={`cursor-pointer ${
                        expandedCampaign === campaign.campaignId ? "bg-slate-50" : ""
                      }`}

                    >

                      <td>
                        {campaign.campaignName}
                      </td>


                      <td>
                        {campaign.campaignId}
                      </td>


                      <td>
                        {campaign.totalOrders}
                      </td>


                      <td>
                        ₹{campaign.totalPayout}
                      </td>


                    </tr>



                    {
                      expandedCampaign === campaign.campaignId &&

                      <tr>

                        <td
                          colSpan="4"
                          className="bg-slate-50 p-5"
                        >


                          <div className="card p-0 overflow-x-auto">
                          <table className="table">

                            <thead>

                              <tr>

                                <th>
                                  Order ID
                                </th>

                                <th>
                                  Amount
                                </th>

                                <th>
                                  Payment
                                </th>

                                <th>
                                  Status
                                </th>

                                <th>
                                  Created At
                                </th>

                              </tr>

                            </thead>



                            <tbody>

                              {
                                campaign.orders.map(
                                  (order)=>(

                                    <tr
                                      key={order.orderId}
                                    >

                                      <td>
                                        {order.orderId}
                                      </td>


                                      <td>
                                        ₹{order.totalAmountPayable}
                                      </td>


                                      <td>
                                        <span className={`badge ${order.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>
                                          {order.paymentType}
                                        </span>
                                      </td>


                                      <td>
                                        {order.paymentStatus}
                                      </td>


                                      <td>
                                        {
                                          new Date(
                                            order.orderCreatedAt
                                          ).toLocaleString()
                                        }
                                      </td>


                                    </tr>

                                  )
                                )
                              }

                            </tbody>


                          </table>
                          </div>


                        </td>

                      </tr>

                    }


                  </>

                )
              )
            }


            </tbody>


          </table>
          </div>


        </>

      }


    </div>
  );
}